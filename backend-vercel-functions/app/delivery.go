package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// --- Sesión / autenticación de repartidor -------------------------------------

func courierID(s *session) (int64, error) {
	id, err := strconv.ParseInt(s.data.Admin.ID, 10, 64)
	if err != nil {
		return 0, errf(http.StatusUnauthorized, "Inicia sesión como repartidor para continuar.")
	}
	return id, nil
}

func (a *App) deliverySession(w http.ResponseWriter, r *http.Request) error {
	s, err := a.session(r)
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	if s.data.Admin != nil && s.data.Admin.Role == "repartidor" {
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

func (a *App) deliveryLogin(w http.ResponseWriter, r *http.Request) error {
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

	var courierIDDB int64
	var courierEmail, passwordHash, role string
	err = a.pool.QueryRow(r.Context(),
		`SELECT admin_id, email, password_hash, role FROM admin_users WHERE lower(email) = $1`,
		email).Scan(&courierIDDB, &courierEmail, &passwordHash, &role)
	matches := false
	if err == nil {
		matches = role == "repartidor" &&
			bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(body.Password)) == nil
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
	s.data.Admin = &adminIdentity{ID: formatID(courierIDDB), Email: courierEmail, Role: "repartidor"}
	s.data.CsrfToken = randHex(32)

	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"email":         courierEmail,
		"csrfToken":     s.data.CsrfToken,
	})
	return nil
}

func (a *App) deliveryLogout(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireCourier(r)
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

// --- Pedidos y ganancias -------------------------------------------------------

type deliveryOrder struct {
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
	Phone           *string         `db:"phone" json:"phone"`
	PaymentStatus   string          `db:"paymentStatus" json:"paymentStatus"`
	Items           []orderItemLine `db:"items" json:"items"`
	ClaimedByMe     bool            `db:"claimedByMe" json:"claimedByMe"`
	ClaimedByOther  bool            `db:"claimedByOther" json:"claimedByOther"`
}

type deliveredRecord struct {
	ID            bigint     `db:"id" json:"id"`
	Shipping      string     `db:"shipping" json:"shipping"`
	Total         string     `db:"total" json:"total"`
	DeliveredAt   *time.Time `db:"deliveredAt" json:"deliveredAt"`
	RecipientName *string    `db:"recipientName" json:"recipientName"`
	VideoURL      *string    `db:"videoUrl" json:"videoUrl"`
	SignatureData *string    `db:"signatureData" json:"signatureData"`
}

func (a *App) deliveryOrders(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireCourier(r)
	if err != nil {
		return err
	}
	courier, err := courierID(s)
	if err != nil {
		return err
	}
	ctx := r.Context()

	var orders []deliveryOrder
	var delivered []deliveredRecord
	var earned, pending float64
	var deliveredCount int
	done := make(chan error, 3)

	go func() {
		var err error
		orders, err = collect[deliveryOrder](a.pool.Query(ctx, `
			SELECT o.order_id AS id, o.status, o.payment_method AS "paymentMethod",
			       o.subtotal_nio AS subtotal, o.discount_nio AS discount,
			       o.shipping_nio AS shipping, o.total_nio AS total, o.created_at AS "createdAt",
			       o.shipping_address AS "shippingAddress", o.notes,
			       (SELECT pl.name FROM petbox_subscriptions s
			        JOIN petbox_plans pl ON pl.plan_id = s.plan_id
			        WHERE s.subscription_id = o.petbox_subscription_id) AS "petboxName",
			       c.first_name AS "firstName", c.last_name AS "lastName",
			       c.phone_whatsapp AS phone,
			       COALESCE(pay.status, 'pendiente') AS "paymentStatus",
			       COALESCE(json_agg(json_build_object(
			         'name', oi.product_name, 'quantity', oi.quantity,
			         'unitPrice', oi.unit_price_nio
			       ) ORDER BY oi.order_item_id) FILTER (WHERE oi.order_item_id IS NOT NULL), '[]'::json) AS items,
			       COALESCE(d.courier_id = $1, FALSE) AS "claimedByMe",
			       COALESCE(d.courier_id IS NOT NULL AND d.courier_id <> $1 AND d.status <> 'entregado', FALSE) AS "claimedByOther"
			FROM orders o
			JOIN customers c ON c.customer_id = o.customer_id
			LEFT JOIN order_items oi ON oi.order_id = o.order_id
			LEFT JOIN order_deliveries d ON d.order_id = o.order_id
			LEFT JOIN LATERAL (
			  SELECT status FROM payments WHERE order_id = o.order_id
			  ORDER BY payment_id DESC LIMIT 1
			) pay ON TRUE
			WHERE o.status NOT IN ('entregado','cancelado')
			GROUP BY o.order_id, c.first_name, c.last_name, c.phone_whatsapp, pay.status,
			         d.courier_id, d.status
			ORDER BY o.created_at DESC LIMIT 100`, courier))
		done <- err
	}()
	go func() {
		var err error
		delivered, err = collect[deliveredRecord](a.pool.Query(ctx, `
			SELECT o.order_id AS id, o.shipping_nio AS shipping, o.total_nio AS total,
			       d.delivered_at AS "deliveredAt", d.recipient_name AS "recipientName",
			       d.video_url AS "videoUrl", d.signature_data AS "signatureData"
			FROM order_deliveries d
			JOIN orders o ON o.order_id = d.order_id
			WHERE d.courier_id = $1 AND d.status = 'entregado' AND o.status = 'entregado'
			ORDER BY d.delivered_at DESC NULLS LAST LIMIT 50`, courier))
		done <- err
	}()
	go func() {
		err := a.pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(o.shipping_nio), 0), COUNT(*)::int
			FROM order_deliveries d
			JOIN orders o ON o.order_id = d.order_id
			WHERE d.courier_id = $1 AND d.status = 'entregado' AND o.status = 'entregado'`,
			courier).Scan(&earned, &deliveredCount)
		if err != nil {
			done <- err
			return
		}
		done <- a.pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(shipping_nio), 0) FROM orders
			WHERE status NOT IN ('entregado','cancelado')`).Scan(&pending)
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
	if a.images.mode == "supabase" {
		refs := make([]*string, 0, len(delivered))
		for i := range delivered {
			refs = append(refs, delivered[i].VideoURL)
		}
		a.signDeliveryVideos(ctx, refs...)
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"orders":    orders,
		"delivered": delivered,
		"earnings": map[string]any{
			"earned":         fixedMoney(earned),
			"pending":        fixedMoney(pending),
			"deliveredCount": deliveredCount,
		},
	})
	return nil
}

// signDeliveryVideos genera URLs firmadas de lectura (1 h) para los videos
// de entrega guardados en el bucket privado, en una sola llamada a Storage.
func (a *App) signDeliveryVideos(ctx context.Context, refs ...*string) {
	marker := "storage://" + a.cfg.deliveryBucket + "/"
	index := map[string]*string{}
	var paths []string
	for _, ref := range refs {
		if ref == nil || !strings.HasPrefix(*ref, marker) {
			continue
		}
		p := (*ref)[len(marker):]
		paths = append(paths, p)
		index[p] = ref
	}
	if len(paths) == 0 {
		return
	}
	payload, err := json.Marshal(map[string]any{"expiresIn": 3600, "paths": paths})
	if err != nil {
		return
	}
	endpoint := fmt.Sprintf("%s/storage/v1/object/sign/%s",
		a.images.supabaseURL, url.PathEscape(a.cfg.deliveryBucket))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("apikey", a.images.supabaseKey)
	req.Header.Set("Authorization", "Bearer "+a.images.supabaseKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.httpClient.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return
	}
	var signed []struct {
		Path      string `json:"path"`
		SignedURL string `json:"signedURL"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&signed); err != nil {
		return
	}
	for _, item := range signed {
		if ref, ok := index[item.Path]; ok && item.SignedURL != "" {
			*ref = a.images.supabaseURL + "/storage/v1" + item.SignedURL
		}
	}
}

// deliveryClaimedByOther comprueba si otro repartidor ya tomó el pedido.
func deliveryClaimedByOther(tx pgx.Tx, ctx context.Context, orderID, courier int64) error {
	var owner *int64
	var dstatus *string
	err := tx.QueryRow(ctx,
		`SELECT courier_id, status FROM order_deliveries WHERE order_id = $1 FOR UPDATE`,
		orderID).Scan(&owner, &dstatus)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if owner != nil && *owner != courier {
		return errf(http.StatusConflict, "Otro repartidor ya registró este pedido.")
	}
	if dstatus != nil && *dstatus == "entregado" {
		return errf(http.StatusConflict, "Este pedido ya fue entregado.")
	}
	return nil
}

func (a *App) deliveryUpdateStatus(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireCourier(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
		return err
	}
	courier, err := courierID(s)
	if err != nil {
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
	if body.Status != "en_camino" {
		return errf(http.StatusBadRequest, "El estado del pedido no es válido.")
	}

	err = a.withTransaction(r.Context(), func(tx pgx.Tx) error {
		var status string
		err := tx.QueryRow(r.Context(),
			`SELECT status FROM orders WHERE order_id = $1 FOR UPDATE`, orderID).Scan(&status)
		if err == pgx.ErrNoRows {
			return errf(http.StatusNotFound, "No se encontró el pedido.")
		}
		if err != nil {
			return err
		}
		if status == "entregado" || status == "cancelado" {
			return errf(http.StatusConflict, "Este pedido ya no está disponible.")
		}
		if err := deliveryClaimedByOther(tx, r.Context(), orderID, courier); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(),
			`UPDATE orders SET status = 'en_camino' WHERE order_id = $1`, orderID); err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(),
			`INSERT INTO order_deliveries (order_id, courier_id, status)
			 VALUES ($1, $2, 'en_camino')
			 ON CONFLICT (order_id) DO UPDATE SET courier_id = EXCLUDED.courier_id`,
			orderID, courier)
		return err
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	return nil
}

// --- Video de prueba de entrega ------------------------------------------------

var videoExtensions = map[string]string{
	"video/webm":      "webm",
	"video/mp4":       "mp4",
	"video/quicktime": "mov",
	"video/x-m4v":     "m4v",
	"video/3gpp":      "3gp",
	"video/3gpp2":     "3g2",
}

func deliveryVideoPath(orderID int64, ext string) string {
	return fmt.Sprintf("deliveries/%d/%s.%s", orderID, newUUID(), ext)
}

// deliveryVideoRef es la referencia persistente al objeto en el bucket
// privado; las URLs de lectura se firman al servir el historial.
func deliveryVideoRef(bucket, objectPath string) string {
	return "storage://" + bucket + "/" + objectPath
}

// deliveryVideoURL crea una URL firmada de subida en Supabase Storage para
// que el navegador suba el video directamente (el body del API de Vercel está
// limitado a ~4.5 MB). En modo local indica que use la subida por el API.
func (a *App) deliveryVideoURL(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireCourier(r)
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
		ContentType string `json:"contentType"`
	}
	if err := readJSON(r, &body); err != nil {
		return err
	}
	ext, ok := videoExtensions[body.ContentType]
	if !ok {
		return errf(http.StatusBadRequest, "Graba el video en un formato compatible (WebM o MP4).")
	}
	if a.images.mode != "supabase" {
		writeJSON(w, http.StatusOK, map[string]any{"mode": "local"})
		return nil
	}
	objectPath := deliveryVideoPath(orderID, ext)
	endpoint := fmt.Sprintf("%s/storage/v1/object/upload/sign/%s/%s",
		a.images.supabaseURL, url.PathEscape(a.cfg.deliveryBucket), encodeObjectPath(objectPath))
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, endpoint, bytes.NewReader([]byte("{}")))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", a.images.supabaseKey)
	req.Header.Set("Authorization", "Bearer "+a.images.supabaseKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.httpClient.Do(req)
	if err != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if resp != nil {
			detail, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
			resp.Body.Close()
			fmt.Printf("Supabase sign respondió %d: %s\n", resp.StatusCode, string(detail))
		}
		return errf(http.StatusBadGateway, "No se pudo preparar la subida del video.")
	}
	defer resp.Body.Close()
	var signed struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&signed); err != nil || signed.URL == "" {
		return errf(http.StatusBadGateway, "No se pudo preparar la subida del video.")
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"mode":      "supabase",
		"uploadUrl": a.images.supabaseURL + "/storage/v1" + signed.URL,
		"path":      objectPath,
		"videoUrl":  deliveryVideoRef(a.cfg.deliveryBucket, objectPath),
	})
	return nil
}

// deliveryVideoUpload guarda el video en disco en desarrollo local, cuando no
// hay Supabase Storage configurado.
func (a *App) deliveryVideoUpload(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireCourier(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
		return err
	}
	if a.images.mode == "supabase" {
		return errf(http.StatusBadRequest, "La subida directa no está disponible con Supabase Storage.")
	}
	if a.cfg.serverless {
		return errf(http.StatusServiceUnavailable, "Configura Supabase Storage para subir videos en producción.")
	}
	orderID, err := positiveID(r.PathValue("orderId"), "El pedido")
	if err != nil {
		return err
	}
	if err := r.ParseMultipartForm(80 << 20); err != nil {
		return errf(http.StatusBadRequest, "Sube un video de hasta 80 MB.")
	}
	file, header, err := r.FormFile("video")
	if err != nil {
		return errf(http.StatusBadRequest, "Sube un video de hasta 80 MB.")
	}
	defer file.Close()
	ext, ok := videoExtensions[header.Header.Get("Content-Type")]
	if !ok {
		return errf(http.StatusBadRequest, "Graba el video en un formato compatible (WebM o MP4).")
	}
	objectPath := deliveryVideoPath(orderID, ext)
	filePath := filepath.Join(a.images.imageDir, filepath.FromSlash(objectPath))
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(filePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, io.LimitReader(file, 80*1024*1024)); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"path": objectPath,
		"url":  "/images/" + objectPath,
	})
	return nil
}

// deliveryProof registra la entrega: video subido, nombre de quien recibió y
// firma digital. Marca el pedido como entregado.
func (a *App) deliveryProof(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireCourier(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
		return err
	}
	courier, err := courierID(s)
	if err != nil {
		return err
	}
	orderID, err := positiveID(r.PathValue("orderId"), "El pedido")
	if err != nil {
		return err
	}
	var body struct {
		VideoPath     string `json:"videoPath"`
		VideoURL      string `json:"videoUrl"`
		RecipientName string `json:"recipientName"`
		SignatureData string `json:"signatureData"`
	}
	if err := readJSON(r, &body); err != nil {
		return err
	}
	recipient, err := requiredText(body.RecipientName, "El nombre de quien recibió", 160)
	if err != nil {
		return err
	}
	videoPath := strings.TrimSpace(body.VideoPath)
	videoURL := strings.TrimSpace(body.VideoURL)
	prefix := fmt.Sprintf("deliveries/%d/", orderID)
	validVideo := strings.HasPrefix(videoPath, prefix) &&
		regexp.MustCompile(`\.(webm|mp4|mov|m4v|3gp|3g2)$`).MatchString(videoPath)
	if a.images.mode == "supabase" {
		validVideo = validVideo && videoURL == deliveryVideoRef(a.cfg.deliveryBucket, videoPath)
	} else {
		validVideo = validVideo && strings.HasPrefix(videoURL, "/images/deliveries/")
	}
	if !validVideo {
		return errf(http.StatusBadRequest, "Sube el video de la entrega antes de confirmar.")
	}
	signature := strings.TrimSpace(body.SignatureData)
	if !strings.HasPrefix(signature, "data:image/png;base64,") || len(signature) > 400_000 {
		return errf(http.StatusBadRequest, "La firma de quien recibió es obligatoria.")
	}

	err = a.withTransaction(r.Context(), func(tx pgx.Tx) error {
		var status string
		err := tx.QueryRow(r.Context(),
			`SELECT status FROM orders WHERE order_id = $1 FOR UPDATE`, orderID).Scan(&status)
		if err == pgx.ErrNoRows {
			return errf(http.StatusNotFound, "No se encontró el pedido.")
		}
		if err != nil {
			return err
		}
		if status == "entregado" || status == "cancelado" {
			return errf(http.StatusConflict, "Este pedido ya no está disponible.")
		}
		if err := deliveryClaimedByOther(tx, r.Context(), orderID, courier); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO order_deliveries
			   (order_id, courier_id, status, recipient_name, signature_data, video_url, video_path, delivered_at)
			 VALUES ($1, $2, 'entregado', $3, $4, $5, $6, now())
			 ON CONFLICT (order_id) DO UPDATE SET
			   status = 'entregado', courier_id = EXCLUDED.courier_id,
			   recipient_name = EXCLUDED.recipient_name,
			   signature_data = EXCLUDED.signature_data,
			   video_url = EXCLUDED.video_url, video_path = EXCLUDED.video_path,
			   delivered_at = now()`,
			orderID, courier, recipient, signature, videoURL, videoPath); err != nil {
			return err
		}
		_, err = tx.Exec(r.Context(),
			`UPDATE orders SET status = 'entregado', delivered_at = COALESCE(delivered_at, now())
			 WHERE order_id = $1`, orderID)
		return err
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	return nil
}
