package app

import (
	"bytes"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

var orderStatuses = map[string]bool{
	"pendiente": true, "confirmado": true, "preparando": true,
	"en_camino": true, "entregado": true, "cancelado": true,
}
var paymentStatuses = map[string]bool{"pendiente": true, "verificado": true, "rechazado": true}
var speciesAllowed = map[string]bool{"perro": true, "gato": true, "ambos": true}

// --- Sesión / autenticación ------------------------------------------------

func (a *App) adminSession(w http.ResponseWriter, r *http.Request) error {
	s, err := a.session(r)
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	if s.data.Admin != nil && s.data.Admin.Role != "repartidor" {
		writeJSON(w, http.StatusOK, map[string]any{
			"authenticated": true,
			"email":         s.data.Admin.Email,
			"csrfToken":     s.data.CsrfToken,
		})
		return nil
	}
	writeJSON(w, http.StatusOK, map[string]any{"authenticated": false})
	return nil
}

func (a *App) adminLogin(w http.ResponseWriter, r *http.Request) error {
	if err := a.sameOrigin(r); err != nil {
		return err
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		return err
	}
	email, err := requiredText(body.Email, "El correo", 150)
	if err != nil {
		return err
	}
	email = lower(email)
	if len(body.Password) < 1 || len(body.Password) > 200 {
		return errf(http.StatusBadRequest, "Escribe tu correo y contraseña.")
	}

	var adminID int64
	var adminEmail, passwordHash, role string
	err = a.pool.QueryRow(r.Context(),
		`SELECT admin_id, email, password_hash, role FROM admin_users WHERE lower(email) = $1`,
		email).Scan(&adminID, &adminEmail, &passwordHash, &role)
	matches := false
	if err == nil {
		matches = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(body.Password)) == nil && role != "repartidor"
	} else if err != pgx.ErrNoRows {
		return err
	}
	if !matches {
		return errf(http.StatusUnauthorized, "El correo o la contraseña no son correctos.")
	}

	s, err := a.session(r)
	if err != nil {
		return err
	}
	s.regenerate()
	s.data.Admin = &adminIdentity{ID: formatID(adminID), Email: adminEmail, Role: "admin"}
	s.data.CsrfToken = randHex(32)

	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"email":         adminEmail,
		"csrfToken":     s.data.CsrfToken,
	})
	return nil
}

func (a *App) adminLogout(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
		return err
	}
	s.destroy()
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// --- Panel -----------------------------------------------------------------

type adminProduct struct {
	ID          bigint         `db:"id" json:"id"`
	Name        string         `db:"name" json:"name"`
	Slug        string         `db:"slug" json:"slug"`
	Description *string        `db:"description" json:"description"`
	Species     string         `db:"species" json:"species"`
	CategoryID  int            `db:"categoryId" json:"categoryId"`
	Category    string         `db:"category" json:"category"`
	Active      bool           `db:"active" json:"active"`
	Image       string         `db:"image" json:"image"`
	HasImage    bool           `db:"hasImage" json:"hasImage"`
	Variants    []adminVariant `db:"variants" json:"variants"`
}

type adminVariant struct {
	ID           int     `json:"id"`
	SKU          *string `json:"sku"`
	Presentation string  `json:"presentation"`
	Price        float64 `json:"price"`
	Stock        int     `json:"stock"`
	Active       bool    `json:"active"`
}

type adminOrder struct {
	ID              bigint          `db:"id" json:"id"`
	Status          string          `db:"status" json:"status"`
	PaymentMethod   string          `db:"paymentMethod" json:"paymentMethod"`
	Subtotal        string          `db:"subtotal" json:"subtotal"`
	Discount        string          `db:"discount" json:"discount"`
	Shipping        string          `db:"shipping" json:"shipping"`
	Total           string          `db:"total" json:"total"`
	CreatedAt       time.Time       `db:"createdAt" json:"createdAt"`
	ShippingAddress string          `db:"shippingAddress" json:"shippingAddress"`
	Notes           *string         `db:"notes" json:"notes,omitempty"`
	PetboxName      *string         `db:"petboxName" json:"petboxName"`
	FirstName       string          `db:"firstName" json:"firstName"`
	LastName        string          `db:"lastName" json:"lastName"`
	Email           string          `db:"email" json:"email"`
	Phone           *string         `db:"phone" json:"phone"`
	PaymentStatus   string              `db:"paymentStatus" json:"paymentStatus"`
	Items           []orderItemLine     `db:"items" json:"items"`
	Delivery        *adminOrderDelivery `db:"delivery" json:"delivery"`
}

// adminOrderDelivery resume la entrega registrada por un repartidor; la
// prueba completa (video firmado y firma) se sirve en /orders/{id}/delivery.
type adminOrderDelivery struct {
	CourierEmail  string     `json:"courierEmail"`
	Status        string     `json:"status"`
	RecipientName *string    `json:"recipientName"`
	DeliveredAt   *time.Time `json:"deliveredAt"`
}

type orderItemLine struct {
	Name      string  `json:"name"`
	Quantity  int     `json:"quantity"`
	UnitPrice float64 `json:"unitPrice"`
}

type adminCategory struct {
	ID   int    `db:"id" json:"id"`
	Name string `db:"name" json:"name"`
}

func (a *App) adminOverview(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.requireAdmin(r); err != nil {
		return err
	}
	ctx := r.Context()

	var products []adminProduct
	var orders []adminOrder
	var categories []adminCategory
	done := make(chan error, 3)

	go func() {
		var err error
		products, err = collect[adminProduct](a.pool.Query(ctx, `
			SELECT p.product_id AS id, p.name, p.slug, p.description, p.target_species AS species,
			       p.category_id AS "categoryId", c.name AS category, p.is_active AS active,
			       COALESCE(
			         (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.product_id
			          ORDER BY pi.sort_order, pi.image_id LIMIT 1),
			         '/images/' || p.slug || '.jpg'
			       ) AS image,
			       EXISTS (
			         SELECT 1 FROM product_images pi WHERE pi.product_id = p.product_id
			       ) AS "hasImage",
			       COALESCE(json_agg(json_build_object(
			         'id', v.variant_id, 'sku', v.sku, 'presentation', v.presentation,
			         'price', v.price_nio, 'stock', v.stock_qty, 'active', v.is_active
			       ) ORDER BY v.variant_id) FILTER (WHERE v.variant_id IS NOT NULL), '[]'::json) AS variants
			FROM products p
			JOIN categories c ON c.category_id = p.category_id
			LEFT JOIN product_variants v ON v.product_id = p.product_id
			GROUP BY p.product_id, c.name ORDER BY p.created_at DESC, p.product_id DESC`))
		done <- err
	}()
	go func() {
		var err error
		orders, err = collect[adminOrder](a.pool.Query(ctx, `
			SELECT o.order_id AS id, o.status, o.payment_method AS "paymentMethod",
			       o.subtotal_nio AS subtotal, o.discount_nio AS discount,
			       o.shipping_nio AS shipping, o.total_nio AS total, o.created_at AS "createdAt",
			       o.shipping_address AS "shippingAddress", o.notes,
			       (SELECT pl.name FROM petbox_subscriptions s
			        JOIN petbox_plans pl ON pl.plan_id = s.plan_id
			        WHERE s.subscription_id = o.petbox_subscription_id) AS "petboxName",
			       c.first_name AS "firstName", c.last_name AS "lastName",
			       c.email, c.phone_whatsapp AS phone,
			       COALESCE(pay.status, 'pendiente') AS "paymentStatus",
			       COALESCE(json_agg(json_build_object(
			         'name', oi.product_name, 'quantity', oi.quantity,
			         'unitPrice', oi.unit_price_nio
			       ) ORDER BY oi.order_item_id) FILTER (WHERE oi.order_item_id IS NOT NULL), '[]'::json) AS items,
			       CASE WHEN d.order_id IS NOT NULL THEN json_build_object(
			         'courierEmail', courier.email, 'status', d.status,
			         'recipientName', d.recipient_name, 'deliveredAt', d.delivered_at
			       ) END AS delivery
			FROM orders o
			JOIN customers c ON c.customer_id = o.customer_id
			LEFT JOIN order_items oi ON oi.order_id = o.order_id
			LEFT JOIN order_deliveries d ON d.order_id = o.order_id
			LEFT JOIN admin_users courier ON courier.admin_id = d.courier_id
			LEFT JOIN LATERAL (
			  SELECT status FROM payments WHERE order_id = o.order_id
			  ORDER BY payment_id DESC LIMIT 1
			) pay ON TRUE
			GROUP BY o.order_id, c.first_name, c.last_name, c.email, c.phone_whatsapp, pay.status,
			         d.order_id, courier.email, d.status, d.recipient_name, d.delivered_at
			ORDER BY o.created_at DESC LIMIT 100`))
		done <- err
	}()
	go func() {
		var err error
		categories, err = collect[adminCategory](a.pool.Query(ctx,
			`SELECT category_id AS id, name FROM categories ORDER BY name`))
		done <- err
	}()

	var qerr error
	for i := 0; i < 3; i++ {
		if err := <-done; err != nil && qerr == nil {
			qerr = err
		}
	}
	if qerr != nil {
		return qerr
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"products":   products,
		"orders":     orders,
		"categories": categories,
	})
	return nil
}

// --- Productos y variantes --------------------------------------------------

func (a *App) adminCreateProduct(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
		return err
	}
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		return err
	}
	name, err := requiredTextAny(body["name"], "El nombre", 150)
	if err != nil {
		return err
	}
	description, err := optionalTextAny(body["description"], "La descripción", 5000)
	if err != nil {
		return err
	}
	slugInput := body["slug"]
	if slugInput == nil || slugInput == "" {
		slugInput = slugify(name)
	}
	slugChecked, err := requiredTextAny(slugInput, "El slug", 160)
	if err != nil {
		return err
	}
	slug := slugify(slugChecked)
	categoryID, err := positiveID(body["categoryId"], "La categoría")
	if err != nil {
		return err
	}
	species := jsonString(body["species"])
	sku, err := requiredTextAny(body["sku"], "El SKU", 40)
	if err != nil {
		return err
	}
	sku = upper(sku)
	presentation, err := requiredTextAny(body["presentation"], "La presentación", 60)
	if err != nil {
		return err
	}
	price, err := nonNegativeNumber(body["price"], "El precio", false, 99999999.99)
	if err != nil {
		return err
	}
	stock, err := nonNegativeNumber(body["stock"], "El inventario", true, 2147483647)
	if err != nil {
		return err
	}
	if slug == "" || !slugValid.MatchString(slug) {
		return errf(http.StatusBadRequest, "El slug solo puede contener letras, números y guiones.")
	}
	if !speciesAllowed[species] {
		return errf(http.StatusBadRequest, "Selecciona perro, gato o ambos.")
	}

	var productID, variantID int64
	err = a.withTransaction(r.Context(), func(tx pgx.Tx) error {
		var exists int
		err := tx.QueryRow(r.Context(),
			`SELECT 1 FROM categories WHERE category_id = $1`, categoryID).Scan(&exists)
		if err == pgx.ErrNoRows {
			return errf(http.StatusBadRequest, "La categoría seleccionada no existe.")
		}
		if err != nil {
			return err
		}
		if err := tx.QueryRow(r.Context(),
			`INSERT INTO products (category_id, name, slug, description, target_species)
			 VALUES ($1, $2, $3, $4, $5) RETURNING product_id`,
			categoryID, name, slug, description, species).Scan(&productID); err != nil {
			return err
		}
		return tx.QueryRow(r.Context(),
			`INSERT INTO product_variants (product_id, sku, presentation, price_nio, stock_qty)
			 VALUES ($1, $2, $3, $4, $5) RETURNING variant_id`,
			productID, sku, presentation, price, int64(stock)).Scan(&variantID)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":        formatID(productID),
		"variantId": formatID(variantID),
	})
	return nil
}

func (a *App) adminUpdateProduct(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
		return err
	}
	productID, err := positiveID(r.PathValue("productId"), "El producto")
	if err != nil {
		return err
	}
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		return err
	}
	name, err := requiredTextAny(body["name"], "El nombre", 150)
	if err != nil {
		return err
	}
	description, err := optionalTextAny(body["description"], "La descripción", 5000)
	if err != nil {
		return err
	}
	slugRaw, err := requiredTextAny(body["slug"], "El slug", 160)
	if err != nil {
		return err
	}
	slug := slugify(slugRaw)
	categoryID, err := positiveID(body["categoryId"], "La categoría")
	if err != nil {
		return err
	}
	species := jsonString(body["species"])
	active, isBool := body["active"].(bool)
	if slug == "" || !slugValid.MatchString(slug) {
		return errf(http.StatusBadRequest, "El slug solo puede contener letras, números y guiones.")
	}
	if !speciesAllowed[species] || !isBool {
		return errf(http.StatusBadRequest, "Revisa la especie y el estado del producto.")
	}
	tag, err := a.pool.Exec(r.Context(),
		`UPDATE products SET name = $1, slug = $2, description = $3, category_id = $4,
		                     target_species = $5, is_active = $6
		 WHERE product_id = $7`,
		name, slug, description, categoryID, species, active, productID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errf(http.StatusNotFound, "No se encontró el producto.")
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	return nil
}

func (a *App) adminCreateVariant(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
		return err
	}
	productID, err := positiveID(r.PathValue("productId"), "El producto")
	if err != nil {
		return err
	}
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		return err
	}
	sku, err := requiredTextAny(body["sku"], "El SKU", 40)
	if err != nil {
		return err
	}
	sku = upper(sku)
	presentation, err := requiredTextAny(body["presentation"], "La presentación", 60)
	if err != nil {
		return err
	}
	price, err := nonNegativeNumber(body["price"], "El precio", false, 99999999.99)
	if err != nil {
		return err
	}
	stock, err := nonNegativeNumber(body["stock"], "El inventario", true, 2147483647)
	if err != nil {
		return err
	}
	var variantID int64
	err = a.pool.QueryRow(r.Context(),
		`INSERT INTO product_variants (product_id, sku, presentation, price_nio, stock_qty)
		 SELECT product_id, $2, $3, $4, $5 FROM products WHERE product_id = $1
		 RETURNING variant_id`,
		productID, sku, presentation, price, int64(stock)).Scan(&variantID)
	if err == pgx.ErrNoRows {
		return errf(http.StatusNotFound, "No se encontró el producto.")
	}
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": formatID(variantID)})
	return nil
}

func (a *App) adminUpdateVariant(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
		return err
	}
	variantID, err := positiveID(r.PathValue("variantId"), "La variante")
	if err != nil {
		return err
	}
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		return err
	}
	sku, err := requiredTextAny(body["sku"], "El SKU", 40)
	if err != nil {
		return err
	}
	sku = upper(sku)
	presentation, err := requiredTextAny(body["presentation"], "La presentación", 60)
	if err != nil {
		return err
	}
	price, err := nonNegativeNumber(body["price"], "El precio", false, 99999999.99)
	if err != nil {
		return err
	}
	stock, err := nonNegativeNumber(body["stock"], "El inventario", true, 2147483647)
	if err != nil {
		return err
	}
	active, isBool := body["active"].(bool)
	if !isBool {
		return errf(http.StatusBadRequest, "Selecciona el estado de la variante.")
	}
	tag, err := a.pool.Exec(r.Context(),
		`UPDATE product_variants
		 SET sku = $1, presentation = $2, price_nio = $3, stock_qty = $4, is_active = $5
		 WHERE variant_id = $6`,
		sku, presentation, price, int64(stock), active, variantID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errf(http.StatusNotFound, "No se encontró la variante.")
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	return nil
}

// --- Imágenes de producto ----------------------------------------------------

type imageTypeInfo struct {
	extension string
	mime      string
}

func sniffImageType(buf []byte) *imageTypeInfo {
	if len(buf) >= 3 && buf[0] == 0xff && buf[1] == 0xd8 && buf[2] == 0xff {
		return &imageTypeInfo{extension: "jpg", mime: "image/jpeg"}
	}
	if len(buf) >= 8 && bytes.Equal(buf[:8], []byte{137, 80, 78, 71, 13, 10, 26, 10}) {
		return &imageTypeInfo{extension: "png", mime: "image/png"}
	}
	if len(buf) >= 12 && string(buf[:4]) == "RIFF" && string(buf[8:12]) == "WEBP" {
		return &imageTypeInfo{extension: "webp", mime: "image/webp"}
	}
	return nil
}

var allowedImageMimes = map[string]bool{
	"image/jpeg": true, "image/png": true, "image/webp": true,
}

// parseImageUpload replica multer.memoryStorage + fileFilter + límite de 5 MB.
func parseImageUpload(r *http.Request) ([]byte, *apiError) {
	if err := r.ParseMultipartForm(6 << 20); err != nil {
		return nil, errf(http.StatusBadRequest, "Selecciona una imagen JPG, PNG o WebP de hasta 5 MB.")
	}
	file, header, err := r.FormFile("image")
	if err != nil {
		return nil, errf(http.StatusBadRequest, "Selecciona una imagen JPG, PNG o WebP de hasta 5 MB.")
	}
	defer file.Close()
	mime := header.Header.Get("Content-Type")
	if !allowedImageMimes[mime] {
		return nil, errf(http.StatusBadRequest, "Usa una imagen JPG, PNG o WebP de hasta 5 MB.")
	}
	buf, err := io.ReadAll(io.LimitReader(file, 5*1024*1024+1))
	if err != nil {
		return nil, errf(http.StatusBadRequest, "Usa una imagen JPG, PNG o WebP de hasta 5 MB.")
	}
	if len(buf) > 5*1024*1024 {
		return nil, errf(http.StatusBadRequest, "La imagen supera el límite de 5 MB.")
	}
	return buf, nil
}

func (a *App) adminUploadProductImage(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
		return err
	}
	productID, err := positiveID(r.PathValue("productId"), "El producto")
	if err != nil {
		return err
	}
	buf, apiErr := parseImageUpload(r)
	if apiErr != nil {
		return apiErr
	}
	imgType := sniffImageType(buf)
	if imgType == nil {
		return errf(http.StatusBadRequest, "El archivo no contiene una imagen JPG, PNG o WebP válida.")
	}

	var stored *storedImage
	var previousURLs []string
	txErr := a.withTransaction(r.Context(), func(tx pgx.Tx) error {
		var exists int64
		err := tx.QueryRow(r.Context(),
			`SELECT product_id FROM products WHERE product_id = $1 FOR UPDATE`, productID).Scan(&exists)
		if err == pgx.ErrNoRows {
			return errf(http.StatusNotFound, "No se encontró el producto.")
		}
		if err != nil {
			return err
		}
		rows, err := tx.Query(r.Context(),
			`SELECT url FROM product_images WHERE product_id = $1 ORDER BY sort_order, image_id FOR UPDATE`,
			productID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var u string
			if err := rows.Scan(&u); err != nil {
				return err
			}
			previousURLs = append(previousURLs, u)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		stored, err = a.images.save(formatID(productID), buf, *imgType)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(),
			`DELETE FROM product_images WHERE product_id = $1`, productID); err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(),
			`INSERT INTO product_images (product_id, url, sort_order) VALUES ($1, $2, 0)`,
			productID, stored.url)
		return err
	})
	if txErr != nil {
		if stored != nil {
			if rmErr := a.images.remove(stored); rmErr != nil {
				// Limpieza best-effort igual que en la versión Node.
				println("No se pudo limpiar una imagen tras un error de base de datos:", rmErr.Error())
			}
		}
		return txErr
	}
	for _, u := range previousURLs {
		if stored != nil && u == stored.url {
			continue
		}
		if _, err := a.images.removeByURL(u); err != nil {
			println("No se pudo eliminar la imagen anterior del producto:", err.Error())
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{"url": stored.url})
	return nil
}

func (a *App) adminDeleteProductImage(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
		return err
	}
	productID, err := positiveID(r.PathValue("productId"), "El producto")
	if err != nil {
		return err
	}
	var urls []string
	err = a.withTransaction(r.Context(), func(tx pgx.Tx) error {
		var exists int64
		err := tx.QueryRow(r.Context(),
			`SELECT product_id FROM products WHERE product_id = $1 FOR UPDATE`, productID).Scan(&exists)
		if err == pgx.ErrNoRows {
			return errf(http.StatusNotFound, "No se encontró el producto.")
		}
		if err != nil {
			return err
		}
		rows, err := tx.Query(r.Context(),
			`SELECT url FROM product_images WHERE product_id = $1 ORDER BY sort_order, image_id FOR UPDATE`,
			productID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var u string
			if err := rows.Scan(&u); err != nil {
				return err
			}
			urls = append(urls, u)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(), `DELETE FROM product_images WHERE product_id = $1`, productID)
		return err
	})
	if err != nil {
		return err
	}
	for _, u := range urls {
		if _, rmErr := a.images.removeByURL(u); rmErr != nil {
			println("No se pudo eliminar una imagen del almacenamiento:", rmErr.Error())
		}
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// --- Pedidos -----------------------------------------------------------------

func (a *App) adminUpdateOrderStatus(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
		return err
	}
	orderID, err := positiveID(r.PathValue("orderId"), "El pedido")
	if err != nil {
		return err
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := readJSON(r, &body); err != nil {
		return err
	}
	if !orderStatuses[body.Status] {
		return errf(http.StatusBadRequest, "El estado del pedido no es válido.")
	}

	err = a.withTransaction(r.Context(), func(tx pgx.Tx) error {
		var previous string
		var subscriptionID *int64
		err := tx.QueryRow(r.Context(),
			`SELECT status, petbox_subscription_id FROM orders WHERE order_id = $1 FOR UPDATE`,
			orderID).Scan(&previous, &subscriptionID)
		if err == pgx.ErrNoRows {
			return errf(http.StatusNotFound, "No se encontró el pedido.")
		}
		if err != nil {
			return err
		}
		if previous == body.Status {
			return nil
		}
		type item struct{ variantID, quantity int64 }
		if previous == "cancelado" && body.Status != "cancelado" {
			rows, err := tx.Query(r.Context(),
				`SELECT variant_id, quantity FROM order_items WHERE order_id = $1 ORDER BY variant_id FOR UPDATE`,
				orderID)
			if err != nil {
				return err
			}
			var items []item
			for rows.Next() {
				var it item
				if err := rows.Scan(&it.variantID, &it.quantity); err != nil {
					rows.Close()
					return err
				}
				items = append(items, it)
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return err
			}
			for _, it := range items {
				tag, err := tx.Exec(r.Context(),
					`UPDATE product_variants SET stock_qty = stock_qty - $1
					 WHERE variant_id = $2 AND stock_qty >= $1`,
					it.quantity, it.variantID)
				if err != nil {
					return err
				}
				if tag.RowsAffected() == 0 {
					return errf(http.StatusConflict, "No hay suficiente inventario para reactivar este pedido.")
				}
			}
		} else if previous != "cancelado" && body.Status == "cancelado" {
			rows, err := tx.Query(r.Context(),
				`SELECT variant_id, quantity FROM order_items WHERE order_id = $1 ORDER BY variant_id FOR UPDATE`,
				orderID)
			if err != nil {
				return err
			}
			var items []item
			for rows.Next() {
				var it item
				if err := rows.Scan(&it.variantID, &it.quantity); err != nil {
					rows.Close()
					return err
				}
				items = append(items, it)
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return err
			}
			for _, it := range items {
				if _, err := tx.Exec(r.Context(),
					`UPDATE product_variants SET stock_qty = stock_qty + $1 WHERE variant_id = $2`,
					it.quantity, it.variantID); err != nil {
					return err
				}
			}
		}
		if _, err := tx.Exec(r.Context(),
			`UPDATE orders SET status = $1,
			     delivered_at = CASE WHEN $1 = 'entregado' THEN COALESCE(delivered_at, now()) ELSE NULL END
			 WHERE order_id = $2`,
			body.Status, orderID); err != nil {
			return err
		}
		if subscriptionID != nil && body.Status == "cancelado" {
			if _, err := tx.Exec(r.Context(),
				`UPDATE petbox_subscriptions SET status = 'cancelada'
				 WHERE subscription_id = $1 AND status <> 'cancelada'`, *subscriptionID); err != nil {
				return err
			}
		} else if subscriptionID != nil && previous == "cancelado" {
			if _, err := tx.Exec(r.Context(),
				`UPDATE petbox_subscriptions SET status = 'activa'
				 WHERE subscription_id = $1 AND status = 'cancelada'`, *subscriptionID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	return nil
}

func (a *App) adminUpdateOrderPayment(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
		return err
	}
	orderID, err := positiveID(r.PathValue("orderId"), "El pedido")
	if err != nil {
		return err
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := readJSON(r, &body); err != nil {
		return err
	}
	if !paymentStatuses[body.Status] {
		return errf(http.StatusBadRequest, "El estado del pago no es válido.")
	}
	var paymentID int64
	err = a.pool.QueryRow(r.Context(),
		`UPDATE payments SET status = $1,
		       paid_at = CASE WHEN $1 = 'verificado' THEN COALESCE(paid_at, now()) ELSE NULL END
		 WHERE payment_id = (
		   SELECT payment_id FROM payments WHERE order_id = $2 ORDER BY payment_id DESC LIMIT 1
		 ) RETURNING payment_id`,
		body.Status, orderID).Scan(&paymentID)
	if err == pgx.ErrNoRows {
		return errf(http.StatusNotFound, "Este pedido no tiene un pago registrable.")
	}
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	return nil
}
