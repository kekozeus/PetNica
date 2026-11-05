package app

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// --- Cuentas de repartidor (gestión desde el panel admin) ---------------------

type adminAccount struct {
	ID         bigint    `db:"id" json:"id"`
	Email      string    `db:"email" json:"email"`
	Role       string    `db:"role" json:"role"`
	CreatedAt  time.Time `db:"createdAt" json:"createdAt"`
	Deliveries int       `db:"deliveries" json:"deliveries"`
	InProgress int       `db:"inProgress" json:"inProgress"`
	Earned     string    `db:"earned" json:"earned"`
}

// adminCouriers lista las cuentas de acceso (admins y repartidores) con las
// estadísticas de entregas de cada repartidor.
func (a *App) adminCouriers(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.requireAdmin(r); err != nil {
		return err
	}
	accounts, err := collect[adminAccount](a.pool.Query(r.Context(), `
		SELECT u.admin_id AS id, u.email, u.role, u.created_at AS "createdAt",
		       COALESCE(stats.deliveries, 0) AS deliveries,
		       COALESCE(stats.in_progress, 0) AS "inProgress",
		       COALESCE(stats.earned, 0) AS earned
		FROM admin_users u
		LEFT JOIN LATERAL (
		  SELECT COUNT(*)::int AS deliveries,
		         COUNT(*) FILTER (WHERE d.status = 'en_camino')::int AS in_progress,
		         COALESCE(SUM(o.shipping_nio)
		                  FILTER (WHERE d.status = 'entregado' AND o.status = 'entregado'), 0) AS earned
		  FROM order_deliveries d
		  JOIN orders o ON o.order_id = d.order_id
		  WHERE d.courier_id = u.admin_id
		) stats ON u.role = 'repartidor'
		ORDER BY u.role, u.created_at, u.admin_id`))
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"accounts": accounts})
	return nil
}

// adminCreateCourier crea una cuenta de repartidor desde el panel admin.
func (a *App) adminCreateCourier(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
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
	if !emailPattern.MatchString(email) {
		return errf(http.StatusBadRequest, "Escribe un correo válido.")
	}
	if len(body.Password) < 12 || len(body.Password) > 200 {
		return errf(http.StatusBadRequest, "La contraseña debe tener entre 12 y 200 caracteres.")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		return err
	}
	var exists int
	err = a.pool.QueryRow(r.Context(),
		`SELECT 1 FROM admin_users WHERE lower(email) = $1`, email).Scan(&exists)
	if err == nil {
		return errf(http.StatusConflict, "Ya existe una cuenta con ese correo.")
	}
	if err != pgx.ErrNoRows {
		return err
	}
	var courierID int64
	if err := a.pool.QueryRow(r.Context(),
		`INSERT INTO admin_users (email, password_hash, role) VALUES ($1, $2, 'repartidor')
		 RETURNING admin_id`, email, string(hash)).Scan(&courierID); err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": formatID(courierID)})
	return nil
}

// adminUpdateCourierPassword restablece la contraseña de una cuenta de
// repartidor (sin tocar cuentas admin).
func (a *App) adminUpdateCourierPassword(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireAdmin(r)
	if err != nil {
		return err
	}
	if err := a.requireAdminCSRF(r, s); err != nil {
		return err
	}
	courier, err := positiveID(r.PathValue("courierId"), "El repartidor")
	if err != nil {
		return err
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		return err
	}
	if len(body.Password) < 12 || len(body.Password) > 200 {
		return errf(http.StatusBadRequest, "La contraseña debe tener entre 12 y 200 caracteres.")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		return err
	}
	tag, err := a.pool.Exec(r.Context(),
		`UPDATE admin_users SET password_hash = $2 WHERE admin_id = $1 AND role = 'repartidor'`,
		courier, string(hash))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errf(http.StatusNotFound, "No se encontró la cuenta de repartidor.")
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	return nil
}

// --- Prueba de entrega de un pedido -----------------------------------------

type adminDeliveryProof struct {
	OrderID       bigint     `db:"orderId" json:"orderId"`
	Status        string     `db:"status" json:"status"`
	CourierEmail  string     `db:"courierEmail" json:"courierEmail"`
	RecipientName *string    `db:"recipientName" json:"recipientName"`
	SignatureData *string    `db:"signatureData" json:"signatureData"`
	VideoURL      *string    `db:"videoUrl" json:"videoUrl"`
	DeliveredAt   *time.Time `db:"deliveredAt" json:"deliveredAt"`
}

// adminOrderDelivery devuelve la prueba de entrega registrada por el
// repartidor (video firmado + firma + receptor) para un pedido.
func (a *App) adminOrderDelivery(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.requireAdmin(r); err != nil {
		return err
	}
	orderID, err := positiveID(r.PathValue("orderId"), "El pedido")
	if err != nil {
		return err
	}
	proofs, err := collect[adminDeliveryProof](a.pool.Query(r.Context(), `
		SELECT d.order_id AS "orderId", d.status, u.email AS "courierEmail",
		       d.recipient_name AS "recipientName", d.signature_data AS "signatureData",
		       d.video_url AS "videoUrl", d.delivered_at AS "deliveredAt"
		FROM order_deliveries d
		JOIN admin_users u ON u.admin_id = d.courier_id
		WHERE d.order_id = $1`, orderID))
	if err != nil {
		return err
	}
	if len(proofs) == 0 {
		return errf(http.StatusNotFound, "Este pedido no tiene una entrega registrada.")
	}
	proof := proofs[0]
	if a.images.mode == "supabase" {
		a.signDeliveryVideos(r.Context(), proof.VideoURL)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"delivery": proof})
	return nil
}
