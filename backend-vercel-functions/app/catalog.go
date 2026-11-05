package app

import (
	"log"
	"net/http"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
)

type categoryRow struct {
	ID   int    `db:"id" json:"id"`
	Name string `db:"name" json:"name"`
	Slug string `db:"slug" json:"slug"`
}

// catalogVariant tipa el json_build_object de Node: re-marshal a float64
// normaliza 520.00 → 520 igual que JSON.parse + res.json.
type catalogVariant struct {
	ID           int     `json:"id"`
	Presentation string  `json:"presentation"`
	Price        float64 `json:"price"`
	Stock        int     `json:"stock"`
}

type catalogProduct struct {
	ID          bigint           `db:"id" json:"id"`
	Name        string           `db:"name" json:"name"`
	Slug        string           `db:"slug" json:"slug"`
	Description *string          `db:"description" json:"description"`
	Species     string           `db:"species" json:"species"`
	Category    string           `db:"category" json:"category"`
	Image       string           `db:"image" json:"image"`
	Rating      string           `db:"rating" json:"rating"` // NUMERIC llega como string, igual que en node-pg
	ReviewCount int              `db:"reviewCount" json:"reviewCount"`
	Variants    []catalogVariant `db:"variants" json:"variants"`
}

type petboxPlan struct {
	ID          int     `db:"id" json:"id"`
	Name        string  `db:"name" json:"name"`
	Description *string `db:"description" json:"description"`
	Species     string  `db:"species" json:"species"`
	Size        *string `db:"size" json:"size"`
	Price       string  `db:"price" json:"price"`
}

type deliveryZone struct {
	ID       int    `db:"id" json:"id"`
	District string `db:"district" json:"district"`
	Fee      string `db:"fee" json:"fee"`
	Days     int    `db:"days" json:"days"`
}

func collect[T any](rows pgx.Rows, err error) ([]T, error) {
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowToStructByNameLax[T])
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = []T{} // node-pg devuelve [], no null
	}
	return out, nil
}

func (a *App) health(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.pool.Exec(r.Context(), "SELECT 1"); err != nil {
		log.Printf("No se pudo comprobar la conexión con PostgreSQL: %v", err)
		return errf(http.StatusServiceUnavailable, "No se pudo conectar con PostgreSQL.")
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "database": "connected"})
	return nil
}

func (a *App) catalog(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()

	type result struct {
		categories []categoryRow
		products   []catalogProduct
		plans      []petboxPlan
		zones      []deliveryZone
	}
	var res result
	var err error

	done := make(chan error, 4)
	go func() {
		res.categories, err = collect[categoryRow](a.pool.Query(ctx,
			`SELECT category_id AS id, name, slug FROM categories ORDER BY category_id`))
		done <- err
	}()
	go func() {
		var productsErr error
		res.products, productsErr = collect[catalogProduct](a.pool.Query(ctx, `
			SELECT p.product_id AS id, p.name, p.slug, p.description,
			       p.target_species AS species, c.name AS category,
			       COALESCE(
			         (SELECT pi.url FROM product_images pi
			          WHERE pi.product_id = p.product_id
			          ORDER BY pi.sort_order, pi.image_id LIMIT 1),
			         '/images/' || p.slug || '.jpg'
			       ) AS image,
			       COALESCE(review_summary.rating, 0) AS rating,
			       COALESCE(review_summary.review_count, 0) AS "reviewCount",
			       json_agg(json_build_object(
			         'id', v.variant_id, 'presentation', v.presentation,
			         'price', v.price_nio, 'stock', v.stock_qty
			       ) ORDER BY v.price_nio, v.variant_id) AS variants
			FROM products p
			JOIN categories c ON c.category_id = p.category_id
			JOIN product_variants v ON v.product_id = p.product_id
			LEFT JOIN (
			  SELECT product_id, avg(rating)::numeric(3,2) AS rating, count(*)::integer AS review_count
			  FROM product_reviews
			  GROUP BY product_id
			) review_summary ON review_summary.product_id = p.product_id
			WHERE p.is_active AND v.is_active
			GROUP BY p.product_id, c.name, review_summary.rating, review_summary.review_count
			ORDER BY p.name`))
		done <- productsErr
	}()
	go func() {
		var plansErr error
		res.plans, plansErr = collect[petboxPlan](a.pool.Query(ctx, `
			SELECT plan_id AS id, name, description, species, size, monthly_price_nio AS price
			FROM petbox_plans WHERE is_active ORDER BY plan_id`))
		done <- plansErr
	}()
	go func() {
		var zonesErr error
		res.zones, zonesErr = collect[deliveryZone](a.pool.Query(ctx, `
			SELECT zone_id AS id, district, shipping_fee_nio AS fee, est_days AS days
			FROM delivery_zones WHERE is_active ORDER BY zone_id`))
		done <- zonesErr
	}()

	for i := 0; i < 4; i++ {
		if qerr := <-done; qerr != nil && err == nil {
			err = qerr
		}
	}
	if err != nil {
		return err
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"categories": res.categories,
		"products":   res.products,
		"plans":      res.plans,
		"zones":      res.zones,
		"whatsapp":   a.cfg.whatsapp,
	})
	return nil
}

var productIDPattern = regexp.MustCompile(`^[1-9]\d{0,18}$`)

type productReview struct {
	Rating       int        `db:"rating" json:"rating"`
	Comment      *string    `db:"comment" json:"comment"`
	CreatedAt    *time.Time `db:"createdAt" json:"createdAt"`
	CustomerName string     `db:"customerName" json:"customerName"`
}

type eligibleOrder struct {
	ID               bigint    `db:"id" json:"id"`
	CreatedAt        time.Time `db:"createdAt" json:"createdAt"`
	DeliveryReviewed bool      `db:"deliveryReviewed" json:"deliveryReviewed"`
}

func (a *App) productDetail(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	rawID := r.PathValue("productId")
	if !productIDPattern.MatchString(rawID) {
		return errf(http.StatusBadRequest, "El producto solicitado no es válido.")
	}
	productID, err := customerPositiveID(rawID, "El producto")
	if err != nil {
		return errf(http.StatusBadRequest, "El producto solicitado no es válido.")
	}

	type detailResult struct {
		product         *catalogProduct
		reviews         []productReview
		deliveryCount   int
		deliveryReviews []productReview
	}
	var res detailResult
	var deliveryRating any = 0 // JS: rating || 0 → string NUMERIC o 0
	done := make(chan error, 4)

	go func() {
		rows, qerr := a.pool.Query(ctx, `
			SELECT p.product_id AS id, p.name, p.slug, p.description,
			       p.target_species AS species, c.name AS category,
			       COALESCE(
			         (SELECT pi.url FROM product_images pi
			          WHERE pi.product_id = p.product_id
			          ORDER BY pi.sort_order, pi.image_id LIMIT 1),
			         '/images/' || p.slug || '.jpg'
			       ) AS image,
			       COALESCE(summary.rating, 0) AS rating,
			       COALESCE(summary.review_count, 0) AS "reviewCount",
			       COALESCE((
			         SELECT json_agg(json_build_object(
			           'id', v.variant_id, 'presentation', v.presentation,
			           'price', v.price_nio, 'stock', v.stock_qty
			         ) ORDER BY v.price_nio, v.variant_id)
			         FROM product_variants v
			         WHERE v.product_id = p.product_id AND v.is_active
			       ), '[]'::json) AS variants
			FROM products p
			JOIN categories c ON c.category_id = p.category_id
			LEFT JOIN (
			  SELECT product_id, avg(rating)::numeric(3,2) AS rating, count(*)::integer AS review_count
			  FROM product_reviews
			  GROUP BY product_id
			) summary ON summary.product_id = p.product_id
			WHERE p.product_id = $1 AND p.is_active`, productID)
		var list []catalogProduct
		list, qerr = collect[catalogProduct](rows, qerr)
		if qerr == nil && len(list) > 0 {
			p := list[0]
			res.product = &p
		}
		done <- qerr
	}()
	go func() {
		var qerr error
		res.reviews, qerr = collect[productReview](a.pool.Query(ctx, `
			SELECT r.rating, r.comment, r.created_at AS "createdAt",
			       c.first_name || ' ' || left(c.last_name, 1) || '.' AS "customerName"
			FROM product_reviews r
			JOIN customers c ON c.customer_id = r.customer_id
			WHERE r.product_id = $1
			ORDER BY r.created_at DESC, r.review_id DESC
			LIMIT 40`, productID))
		done <- qerr
	}()
	go func() {
		var rating *string
		var count int
		qerr := a.pool.QueryRow(ctx, `
			SELECT avg(rating)::numeric(3,2) AS rating, count(*)::integer AS "reviewCount"
			FROM order_delivery_reviews`).Scan(&rating, &count)
		if qerr == nil && rating != nil {
			deliveryRating = *rating
		}
		res.deliveryCount = count
		done <- qerr
	}()
	go func() {
		var qerr error
		res.deliveryReviews, qerr = collect[productReview](a.pool.Query(ctx, `
			SELECT r.rating, r.comment, r.created_at AS "createdAt",
			       c.first_name || ' ' || left(c.last_name, 1) || '.' AS "customerName"
			FROM order_delivery_reviews r
			JOIN customers c ON c.customer_id = r.customer_id
			ORDER BY r.created_at DESC, r.review_id DESC
			LIMIT 20`))
		done <- qerr
	}()

	var qerr error
	for i := 0; i < 4; i++ {
		if e := <-done; e != nil && qerr == nil {
			qerr = e
		}
	}
	if qerr != nil {
		return qerr
	}
	if res.product == nil {
		return errf(http.StatusNotFound, "No encontramos ese producto.")
	}

	var eligible []eligibleOrder
	hasReviewed := false
	if customerID, _ := a.customerID(r); customerID != "" {
		// Pedidos entregados cuya entrega aún no fue valorada: alimentan la
		// sección de reseña de entrega del formulario.
		list, err := collect[eligibleOrder](a.pool.Query(ctx, `
			SELECT o.order_id AS id, o.created_at AS "createdAt",
			       FALSE AS "deliveryReviewed"
			FROM orders o
			WHERE o.customer_id = $1 AND o.status = 'entregado'
			  AND NOT EXISTS (
			    SELECT 1 FROM order_delivery_reviews dr WHERE dr.order_id = o.order_id
			  )
			ORDER BY o.created_at DESC
			LIMIT 50`, customerID))
		if err != nil {
			return err
		}
		eligible = list
		if err := a.pool.QueryRow(ctx,
			`SELECT EXISTS(
			   SELECT 1 FROM product_reviews WHERE customer_id = $1 AND product_id = $2
			 )`, customerID, productID).Scan(&hasReviewed); err != nil {
			return err
		}
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"product":             res.product,
		"reviews":             res.reviews,
		"deliveryRating":      deliveryRating,
		"deliveryReviewCount": res.deliveryCount,
		"deliveryReviews":     res.deliveryReviews,
		"eligibleOrders":      eligible,
		"hasReviewed":         hasReviewed,
	})
	return nil
}
