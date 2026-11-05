package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

func (a *App) googleConfigured() bool {
	return a.cfg.googleClientID != "" && a.cfg.googleClientSecret != ""
}

func validRating(value any) (int64, error) {
	f, ok := value.(float64)
	if !ok {
		if s, isStr := value.(string); isStr {
			parsed, err := strconv.ParseFloat(s, 64)
			if err == nil {
				f = parsed
				ok = true
			}
		}
	}
	rating := int64(f)
	if !ok || f != float64(rating) || rating < 1 || rating > 5 {
		return 0, errf(http.StatusBadRequest, "Selecciona una calificación de 1 a 5 estrellas.")
	}
	return rating, nil
}

// optionalComment replica optionalComment de customer-router.js.
func optionalComment(value any, label string) (*string, error) {
	if value == nil || value == "" {
		return nil, nil
	}
	s, ok := value.(string)
	if !ok || len(s) > 2000 {
		return nil, errf(http.StatusBadRequest, "%s no puede superar 2000 caracteres.", label)
	}
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return nil, nil
	}
	return &trimmed, nil
}

// --- Google OAuth -----------------------------------------------------------

func (a *App) googleAuthURL(w http.ResponseWriter, r *http.Request) error {
	if !a.googleConfigured() {
		return errf(http.StatusServiceUnavailable, "El acceso con Google todavía no está configurado.")
	}
	s, err := a.session(r)
	if err != nil {
		return err
	}
	s.data.GoogleOAuth = &oauthState{State: randHex(32), Nonce: randHex(32)}
	s.dirty = true

	params := url.Values{
		"client_id":     {a.cfg.googleClientID},
		"redirect_uri":  {a.cfg.googleCallbackURL},
		"response_type": {"code"},
		"scope":         {"openid email profile"},
		"access_type":   {"online"},
		"state":         {s.data.GoogleOAuth.State},
		"nonce":         {s.data.GoogleOAuth.Nonce},
		"prompt":        {"select_account"},
	}
	http.Redirect(w, r,
		"https://accounts.google.com/o/oauth2/v2/auth?"+params.Encode(), http.StatusFound)
	return nil
}

type googleTokenResponse struct {
	IDToken string `json:"id_token"`
}

type googleIdentity struct {
	Sub           string
	Email         string
	EmailVerified bool
	Nonce         string
	Name          string
	GivenName     string
	FamilyName    string
}

// exchangeGoogleCode replica googleClient.getToken(code).
func (a *App) exchangeGoogleCode(ctx context.Context, code string) (*googleTokenResponse, error) {
	resp, err := a.httpClient.PostForm("https://oauth2.googleapis.com/token", url.Values{
		"code":          {code},
		"client_id":     {a.cfg.googleClientID},
		"client_secret": {a.cfg.googleClientSecret},
		"redirect_uri":  {a.cfg.googleCallbackURL},
		"grant_type":    {"authorization_code"},
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var tokens googleTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokens); err != nil {
		return nil, err
	}
	return &tokens, nil
}

// verifyGoogleIDToken valida el id_token contra Google (tokeninfo verifica
// la firma y la expiración) y devuelve los claims relevantes.
func (a *App) verifyGoogleIDToken(idToken string) (*googleIdentity, error) {
	resp, err := a.httpClient.Get(
		"https://oauth2.googleapis.com/tokeninfo?id_token=" + url.QueryEscape(idToken))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google rechazó el id_token (status %d)", resp.StatusCode)
	}
	var claims struct {
		Aud           string `json:"aud"`
		Sub           string `json:"sub"`
		Email         string `json:"email"`
		EmailVerified string `json:"email_verified"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&claims); err != nil {
		return nil, err
	}
	if claims.Aud != a.cfg.googleClientID {
		return nil, fmt.Errorf("aud del id_token no coincide con GOOGLE_CLIENT_ID")
	}
	identity := &googleIdentity{
		Sub:           claims.Sub,
		Email:         claims.Email,
		EmailVerified: claims.EmailVerified == "true",
	}
	// Decodifica el payload del JWT para nonce y nombre (la firma ya fue
	// verificada por el endpoint tokeninfo).
	parts := strings.Split(idToken, ".")
	if len(parts) == 3 {
		if payload, err := base64.RawURLEncoding.DecodeString(parts[1]); err == nil {
			var body struct {
				Nonce      string `json:"nonce"`
				Name       string `json:"name"`
				GivenName  string `json:"given_name"`
				FamilyName string `json:"family_name"`
			}
			if json.Unmarshal(payload, &body) == nil {
				identity.Nonce = body.Nonce
				identity.Name = body.Name
				identity.GivenName = body.GivenName
				identity.FamilyName = body.FamilyName
			}
		}
	}
	return identity, nil
}

func (a *App) googleCallback(w http.ResponseWriter, r *http.Request) error {
	s, err := a.session(r)
	if err != nil {
		return err
	}
	stored := s.data.GoogleOAuth
	s.data.GoogleOAuth = nil
	s.dirty = true

	redirectError := func() error {
		http.Redirect(w, r, "/?cuenta=google-error", http.StatusFound)
		return nil
	}

	q := r.URL.Query()
	if !a.googleConfigured() || q.Get("error") != "" || q.Get("code") == "" ||
		q.Get("state") == "" || stored == nil || stored.State == "" ||
		!safeEqual(q.Get("state"), stored.State) {
		return redirectError()
	}

	tokens, err := a.exchangeGoogleCode(r.Context(), q.Get("code"))
	if err != nil {
		return err
	}
	if tokens.IDToken == "" {
		return redirectError()
	}
	identity, err := a.verifyGoogleIDToken(tokens.IDToken)
	if err != nil {
		return err
	}
	if identity == nil || identity.Sub == "" || identity.Email == "" ||
		!identity.EmailVerified || !safeEqual(identity.Nonce, stored.Nonce) {
		return redirectError()
	}
	if len(identity.Email) > 150 {
		return redirectError()
	}

	// Replica el JS: nameParts.shift() solo muta si given_name está vacío
	// (short-circuit de ||), lo que afecta el join del apellido.
	nameParts := strings.Fields(identity.Name)
	firstName := identity.GivenName
	if firstName == "" {
		if len(nameParts) > 0 {
			firstName = nameParts[0]
			nameParts = nameParts[1:]
		} else {
			firstName = "Cliente"
		}
	}
	lastName := identity.FamilyName
	if lastName == "" {
		if len(nameParts) > 0 {
			lastName = strings.Join(nameParts, " ")
		} else {
			lastName = "Google"
		}
	}
	firstName = truncate(firstName, 80)
	lastName = truncate(lastName, 80)

	type customerRow struct {
		id        int64
		firstName string
		lastName  string
		email     string
		phone     *string
	}
	var customer customerRow
	err = a.withTransaction(r.Context(), func(tx pgx.Tx) error {
		var row struct {
			id           int64
			firstName    string
			lastName     string
			email        string
			phone        *string
			passwordHash *string
			googleSub    *string
		}
		err := tx.QueryRow(r.Context(),
			`SELECT customer_id, first_name, last_name, email, phone_whatsapp, password_hash, google_sub
			 FROM customers
			 WHERE google_sub = $1 OR lower(email) = $2
			 ORDER BY (google_sub = $1) DESC
			 LIMIT 1 FOR UPDATE`,
			identity.Sub, lower(identity.Email)).
			Scan(&row.id, &row.firstName, &row.lastName, &row.email, &row.phone,
				&row.passwordHash, &row.googleSub)
		if err == pgx.ErrNoRows {
			referralCode := "PN" + strings.ToUpper(randHex(6))
			err = tx.QueryRow(r.Context(),
				`INSERT INTO customers (first_name, last_name, email, google_sub, referral_code)
				 VALUES ($1, $2, $3, $4, $5)
				 RETURNING customer_id, first_name, last_name, email, phone_whatsapp`,
				firstName, lastName, lower(identity.Email), identity.Sub, referralCode).
				Scan(&customer.id, &customer.firstName, &customer.lastName, &customer.email, &customer.phone)
			return err
		}
		if err != nil {
			return err
		}
		if row.googleSub != nil && *row.googleSub != "" && *row.googleSub != identity.Sub {
			return errf(http.StatusConflict, "Esta cuenta ya está vinculada con otro acceso de Google.")
		}
		if row.passwordHash != nil && strings.HasPrefix(*row.passwordHash, "$2") &&
			(row.googleSub == nil || *row.googleSub != identity.Sub) {
			return errf(http.StatusConflict, "Ya existe una cuenta con contraseña para este correo. Inicia sesión con correo y contraseña.")
		}
		return tx.QueryRow(r.Context(),
			`UPDATE customers SET google_sub = $1
			 WHERE customer_id = $2
			 RETURNING customer_id, first_name, last_name, email, phone_whatsapp`,
			identity.Sub, row.id).
			Scan(&customer.id, &customer.firstName, &customer.lastName, &customer.email, &customer.phone)
	})
	if err != nil {
		return err
	}

	s.regenerate()
	s.data.Customer = &customerIdentity{ID: formatID(customer.id)}
	s.data.CustomerCsrfToken = randHex(32)
	http.Redirect(w, r, "/?cuenta=google-success", http.StatusFound)
	return nil
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

// --- Sesión de cliente -------------------------------------------------------

func (a *App) customerSession(w http.ResponseWriter, r *http.Request) error {
	s, err := a.session(r)
	if err != nil {
		return err
	}
	if s.data.CustomerCsrfToken == "" {
		s.data.CustomerCsrfToken = randHex(32)
		s.dirty = true
	}
	payload := map[string]any{
		"authenticated":    false,
		"csrfToken":        s.data.CustomerCsrfToken,
		"googleConfigured": a.googleConfigured(),
		"adminSession":     s.data.Admin != nil && s.data.Admin.Role != "repartidor",
	}
	if s.data.Customer != nil {
		var cust struct {
			id            int64
			firstName     string
			lastName      string
			email         string
			phone         *string
			termsAccepted bool
			promoEligible bool
		}
		err := a.pool.QueryRow(r.Context(),
			`SELECT customer_id AS id, first_name AS "firstName", last_name AS "lastName", email,
			        phone_whatsapp AS phone,
			        (terms_accepted_at IS NOT NULL) AS "termsAccepted",
			        NOT EXISTS (
			          SELECT 1 FROM orders WHERE customer_id = $1 AND status <> 'cancelado'
			        ) AS "promoEligible"
			 FROM customers WHERE customer_id = $1`, s.data.Customer.ID).
			Scan(&cust.id, &cust.firstName, &cust.lastName, &cust.email, &cust.phone,
				&cust.termsAccepted, &cust.promoEligible)
		if err == pgx.ErrNoRows {
			s.data.Customer = nil
			s.dirty = true
		} else if err != nil {
			return err
		} else {
			payload["authenticated"] = true
			payload["promoEligible"] = cust.promoEligible
			payload["customer"] = map[string]any{
				"id":            formatID(cust.id),
				"firstName":     cust.firstName,
				"lastName":      cust.lastName,
				"email":         cust.email,
				"phone":         cust.phone,
				"termsAccepted": cust.termsAccepted,
			}
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, payload)
	return nil
}

func customerPayload(id int64, firstName, lastName, email string, phone *string) map[string]any {
	return map[string]any{
		"id":        formatID(id),
		"firstName": firstName,
		"lastName":  lastName,
		"email":     email,
		"phone":     phone,
	}
}

func (a *App) customerRegister(w http.ResponseWriter, r *http.Request) error {
	s, err := a.session(r)
	if err != nil {
		return err
	}
	if err := a.requireCustomerCSRF(r, s); err != nil {
		return err
	}
	if s.data.Admin != nil {
		return errf(http.StatusConflict, "Hay una sesión de administrador activa en este navegador. Ciérrala en el panel de administración para usar una cuenta de cliente.")
	}
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		return err
	}
	firstName, err := customerTextAny(body["firstName"], "El nombre", 80)
	if err != nil {
		return err
	}
	lastName, err := customerTextAny(body["lastName"], "El apellido", 80)
	if err != nil {
		return err
	}
	email, err := customerTextAny(body["email"], "El correo", 150)
	if err != nil {
		return err
	}
	email = lower(email)
	phone, err := optionalTextAny(body["phone"], "El WhatsApp", 20)
	if err != nil {
		return err
	}
	password, _ := body["password"].(string)
	if !emailPattern.MatchString(email) {
		return errf(http.StatusBadRequest, "Escribe un correo electrónico válido.")
	}
	if len(password) < 12 || len(password) > 200 {
		return errf(http.StatusBadRequest, "La contraseña debe tener entre 12 y 200 caracteres.")
	}

	var exists string
	err = a.pool.QueryRow(r.Context(),
		`SELECT password_hash FROM customers WHERE lower(email) = $1`, email).Scan(&exists)
	if err == nil {
		return errf(http.StatusConflict, "Ya existe una cuenta con ese correo. Inicia sesión o usa Google si corresponde.")
	}
	if err != pgx.ErrNoRows {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return err
	}
	referralCode := "PN" + strings.ToUpper(randHex(6))

	var cust struct {
		id        int64
		firstName string
		lastName  string
		email     string
		phone     *string
	}
	err = a.pool.QueryRow(r.Context(),
		`INSERT INTO customers (first_name, last_name, email, phone_whatsapp, password_hash, referral_code)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING customer_id, first_name, last_name, email, phone_whatsapp`,
		firstName, lastName, email, phone, string(hash), referralCode).
		Scan(&cust.id, &cust.firstName, &cust.lastName, &cust.email, &cust.phone)
	if err != nil {
		return err // 23505 lo mapea el middleware de errores
	}

	s.regenerate()
	s.data.Customer = &customerIdentity{ID: formatID(cust.id)}
	s.data.CustomerCsrfToken = randHex(32)
	writeJSON(w, http.StatusCreated, map[string]any{
		"authenticated": true,
		"csrfToken":     s.data.CustomerCsrfToken,
		"customer":      customerPayload(cust.id, cust.firstName, cust.lastName, cust.email, cust.phone),
	})
	return nil
}

func (a *App) customerLogin(w http.ResponseWriter, r *http.Request) error {
	s, err := a.session(r)
	if err != nil {
		return err
	}
	if err := a.requireCustomerCSRF(r, s); err != nil {
		return err
	}
	if s.data.Admin != nil {
		return errf(http.StatusConflict, "Hay una sesión de administrador activa en este navegador. Ciérrala en el panel de administración para usar una cuenta de cliente.")
	}
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		return err
	}
	email, err := customerTextAny(body["email"], "El correo", 150)
	if err != nil {
		return err
	}
	email = lower(email)
	password, _ := body["password"].(string)
	if !emailPattern.MatchString(email) || len(password) > 200 {
		return errf(http.StatusBadRequest, "Escribe un correo y una contraseña válidos.")
	}

	var cust struct {
		id           int64
		firstName    string
		lastName     string
		email        string
		phone        *string
		passwordHash *string
	}
	err = a.pool.QueryRow(r.Context(),
		`SELECT customer_id, first_name, last_name, email, phone_whatsapp, password_hash
		 FROM customers WHERE lower(email) = $1`, email).
		Scan(&cust.id, &cust.firstName, &cust.lastName, &cust.email, &cust.phone, &cust.passwordHash)
	valid := false
	if err == nil && cust.passwordHash != nil {
		valid = bcrypt.CompareHashAndPassword([]byte(*cust.passwordHash), []byte(password)) == nil
	} else if err != nil && err != pgx.ErrNoRows {
		return err
	}
	if !valid {
		return errf(http.StatusUnauthorized, "El correo o la contraseña no son correctos.")
	}

	s.regenerate()
	s.data.Customer = &customerIdentity{ID: formatID(cust.id)}
	s.data.CustomerCsrfToken = randHex(32)
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"csrfToken":     s.data.CustomerCsrfToken,
		"customer":      customerPayload(cust.id, cust.firstName, cust.lastName, cust.email, cust.phone),
	})
	return nil
}

func (a *App) customerLogout(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireCustomer(r)
	if err != nil {
		return err
	}
	if err := a.requireCustomerCSRF(r, s); err != nil {
		return err
	}
	// regenerate() destruye la sesión anterior en petnica_sessions y emite
	// un sid nuevo: el identificador previo deja de ser válido al cerrar sesión.
	s.regenerate()
	s.data.CustomerCsrfToken = randHex(32)
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": false,
		"csrfToken":     s.data.CustomerCsrfToken,
	})
	return nil
}

// --- Carrito -----------------------------------------------------------------

type cartItem struct {
	VariantID bigint `db:"variantId" json:"variantId"`
	Quantity  int    `db:"quantity" json:"quantity"`
	Stock     int    `db:"stock" json:"stock"`
}

type cartPetbox struct {
	PlanID  int     `db:"planId" json:"planId"`
	PetName *string `db:"petName" json:"petName"`
	Size    *string `db:"size" json:"size"`
}

func (a *App) customerGetCart(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireCustomer(r)
	if err != nil {
		return err
	}
	var cartID int64
	err = a.pool.QueryRow(r.Context(),
		`SELECT cart_id FROM carts WHERE customer_id = $1`, s.data.Customer.ID).Scan(&cartID)
	if err == pgx.ErrNoRows {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "petbox": nil})
		return nil
	}
	if err != nil {
		return err
	}

	var items []cartItem
	var petbox *cartPetbox
	done := make(chan error, 2)
	go func() {
		var qerr error
		items, qerr = collect[cartItem](a.pool.Query(r.Context(), `
			SELECT ci.variant_id AS "variantId", ci.quantity, v.stock_qty AS stock
			FROM cart_items ci JOIN product_variants v ON v.variant_id = ci.variant_id
			WHERE ci.cart_id = $1 ORDER BY ci.variant_id`, cartID))
		done <- qerr
	}()
	go func() {
		list, qerr := collect[cartPetbox](a.pool.Query(r.Context(), `
			SELECT plan_id AS "planId", pet_name AS "petName", pet_size AS size
			FROM cart_petbox_items WHERE cart_id = $1`, cartID))
		if qerr == nil && len(list) > 0 {
			petbox = &list[0]
		}
		done <- qerr
	}()
	for i := 0; i < 2; i++ {
		if qerr := <-done; qerr != nil {
			return qerr
		}
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "petbox": petbox})
	return nil
}

func (a *App) customerPutCart(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireCustomer(r)
	if err != nil {
		return err
	}
	if err := a.requireCustomerCSRF(r, s); err != nil {
		return err
	}
	var body struct {
		Items  []orderItemInput `json:"items"`
		Petbox *petboxInput     `json:"petbox"`
	}
	if err := readJSON(r, &body); err != nil {
		return err
	}
	if body.Items == nil || len(body.Items) > 50 {
		return errf(http.StatusBadRequest, "El carrito no es válido.")
	}
	quantities := map[string]int64{}
	for _, item := range body.Items {
		variantID := ""
		if truthy(item.VariantID) {
			variantID = variantKey(item.VariantID)
		}
		quantity, isInt := integerParam(item.Quantity)
		if !orderIDStringPattern.MatchString(variantID) || !isInt || quantity < 1 || quantity > 99 {
			return errf(http.StatusBadRequest, "Hay un producto o cantidad inválida en el carrito.")
		}
		quantities[variantID] += quantity
		if quantities[variantID] > 99 {
			return errf(http.StatusBadRequest, "La cantidad máxima por producto es 99.")
		}
	}

	err = a.withTransaction(r.Context(), func(tx pgx.Tx) error {
		ctx := r.Context()
		var cartID int64
		err := tx.QueryRow(ctx,
			`INSERT INTO carts (customer_id) VALUES ($1)
			 ON CONFLICT (customer_id) DO UPDATE SET updated_at = now()
			 RETURNING cart_id`, s.data.Customer.ID).Scan(&cartID)
		if err != nil {
			return err
		}
		for variantID, quantity := range quantities {
			var exists int64
			var stock int64
			err := tx.QueryRow(ctx,
				`SELECT v.variant_id, v.stock_qty
				 FROM product_variants v JOIN products p ON p.product_id = v.product_id
				 WHERE v.variant_id = $1 AND v.is_active AND p.is_active FOR SHARE OF v`,
				variantID).Scan(&exists, &stock)
			if err == pgx.ErrNoRows || stock < quantity {
				return errf(http.StatusConflict, "Un producto ya no está disponible o no tiene existencias suficientes.")
			}
			if err != nil {
				return err
			}
		}
		var plan *struct {
			id      int64
			species string
			size    *string
		}
		if body.Petbox != nil {
			planIDStr := ""
			if truthy(body.Petbox.PlanID) {
				planIDStr = variantKey(body.Petbox.PlanID)
			}
			if !orderIDStringPattern.MatchString(planIDStr) {
				return errf(http.StatusBadRequest, "El plan PetBox no es válido.")
			}
			var p struct {
				id      int64
				species string
				size    *string
			}
			err := tx.QueryRow(ctx,
				`SELECT plan_id, species, size FROM petbox_plans
				 WHERE plan_id = $1 AND is_active FOR SHARE`, planIDStr).
				Scan(&p.id, &p.species, &p.size)
			if err == pgx.ErrNoRows {
				return errf(http.StatusConflict, "El plan PetBox ya no está disponible.")
			}
			if err != nil {
				return err
			}
			if p.species == "perro" && body.Petbox.Size != nil && *body.Petbox.Size != "" &&
				(p.size == nil || *p.size != *body.Petbox.Size) {
				return errf(http.StatusConflict, "El plan PetBox ya no está disponible.")
			}
			if body.Petbox.PetName != "" {
				if _, err := requiredText(body.Petbox.PetName, "El nombre de la mascota", 80); err != nil {
					return err
				}
			}
			plan = &p
		}
		if _, err := tx.Exec(ctx, `DELETE FROM cart_items WHERE cart_id = $1`, cartID); err != nil {
			return err
		}
		for variantID, quantity := range quantities {
			if _, err := tx.Exec(ctx,
				`INSERT INTO cart_items (cart_id, variant_id, quantity) VALUES ($1, $2, $3)`,
				cartID, variantID, quantity); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM cart_petbox_items WHERE cart_id = $1`, cartID); err != nil {
			return err
		}
		if plan != nil {
			var petName *string
			if body.Petbox.PetName != "" {
				name := body.Petbox.PetName
				petName = &name
			}
			var petSize *string
			if plan.species == "perro" {
				petSize = plan.size
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO cart_petbox_items (cart_id, plan_id, pet_name, pet_size)
				 VALUES ($1, $2, $3, $4)`, cartID, plan.id, petName, petSize); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"saved": true})
	return nil
}

// --- Pedidos del cliente -------------------------------------------------------

func (a *App) customerOrders(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireCustomer(r)
	if err != nil {
		return err
	}
	orders, err := collect[adminOrder](a.pool.Query(r.Context(), `
		SELECT o.order_id AS id, o.status, o.payment_method AS "paymentMethod",
		       o.subtotal_nio AS subtotal, o.discount_nio AS discount,
		       o.shipping_nio AS shipping, o.total_nio AS total,
		       o.created_at AS "createdAt", o.shipping_address AS "shippingAddress",
		       c.first_name AS "firstName", c.last_name AS "lastName",
		       c.email, c.phone_whatsapp AS phone,
		       COALESCE(pay.status, 'pendiente') AS "paymentStatus",
		       (SELECT pl.name FROM petbox_subscriptions s
		        JOIN petbox_plans pl ON pl.plan_id = s.plan_id
		        WHERE s.subscription_id = o.petbox_subscription_id) AS "petboxName",
		       COALESCE(json_agg(json_build_object(
		         'name', oi.product_name, 'quantity', oi.quantity,
		         'unitPrice', oi.unit_price_nio
		       ) ORDER BY oi.order_item_id) FILTER (WHERE oi.order_item_id IS NOT NULL), '[]'::json) AS items
		FROM orders o
		JOIN customers c ON c.customer_id = o.customer_id
		LEFT JOIN order_items oi ON oi.order_id = o.order_id
		LEFT JOIN LATERAL (
		  SELECT status FROM payments WHERE order_id = o.order_id
		  ORDER BY payment_id DESC LIMIT 1
		) pay ON TRUE
		WHERE o.customer_id = $1
		GROUP BY o.order_id, c.first_name, c.last_name, c.email, c.phone_whatsapp, pay.status
		ORDER BY o.created_at DESC LIMIT 100`, s.data.Customer.ID))
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"orders": orders})
	return nil
}

// --- Reseñas -------------------------------------------------------------------

func (a *App) customerReviews(w http.ResponseWriter, r *http.Request) error {
	s, err := a.requireCustomer(r)
	if err != nil {
		return err
	}
	if err := a.requireCustomerCSRF(r, s); err != nil {
		return err
	}
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		return err
	}
	productID, err := customerPositiveID(body["productId"], "El producto")
	if err != nil {
		return err
	}
	var orderID *int64
	if truthy(body["orderId"]) {
		id, err := customerPositiveID(body["orderId"], "El pedido")
		if err != nil {
			return err
		}
		orderID = &id
	}
	var productRating *int64
	if truthy(body["productRating"]) {
		rating, err := validRating(body["productRating"])
		if err != nil {
			return err
		}
		productRating = &rating
	}
	var deliveryRating *int64
	if truthy(body["deliveryRating"]) {
		rating, err := validRating(body["deliveryRating"])
		if err != nil {
			return err
		}
		deliveryRating = &rating
	}
	if productRating == nil && deliveryRating == nil {
		return errf(http.StatusBadRequest, "Elige al menos una calificación.")
	}
	if deliveryRating != nil && orderID == nil {
		return errf(http.StatusBadRequest, "Elige el pedido entregado que quieres valorar.")
	}
	productComment, err := optionalComment(body["productComment"], "El comentario del producto")
	if err != nil {
		return err
	}
	deliveryComment, err := optionalComment(body["deliveryComment"], "El comentario de la entrega")
	if err != nil {
		return err
	}
	customerID := s.data.Customer.ID

	var deliveryReviewed bool
	err = a.withTransaction(r.Context(), func(tx pgx.Tx) error {
		ctx := r.Context()
		var exists int64

		if orderID != nil {
			// La reseña de entrega exige un pedido propio ya entregado.
			err := tx.QueryRow(ctx,
				`SELECT order_id FROM orders
				 WHERE order_id = $1 AND customer_id = $2 AND status = 'entregado'
				 FOR UPDATE`, *orderID, customerID).Scan(&exists)
			if err == pgx.ErrNoRows {
				return errf(http.StatusForbidden, "Solo puedes valorar compras entregadas de tu cuenta.")
			}
			if err != nil {
				return err
			}
		}

		if productRating != nil {
			err := tx.QueryRow(ctx,
				`SELECT 1 FROM products WHERE product_id = $1 AND is_active`, productID).Scan(&exists)
			if err == pgx.ErrNoRows {
				return errf(http.StatusNotFound, "No encontramos ese producto.")
			}
			if err != nil {
				return err
			}
			err = tx.QueryRow(ctx,
				`SELECT 1 FROM product_reviews
				 WHERE customer_id = $1 AND product_id = $2`,
				customerID, productID).Scan(&exists)
			if err == nil {
				return errf(http.StatusConflict, "Ya valoraste este producto.")
			}
			if err != pgx.ErrNoRows {
				return err
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO product_reviews (product_id, customer_id, order_id, rating, comment)
				 VALUES ($1, $2, $3, $4, $5)`,
				productID, customerID, nil, *productRating, productComment); err != nil {
				return err
			}
		}

		if deliveryRating != nil {
			err := tx.QueryRow(ctx,
				`SELECT 1 FROM order_delivery_reviews WHERE order_id = $1`, *orderID).Scan(&exists)
			if err != nil && err != pgx.ErrNoRows {
				return err
			}
			deliveryReviewed = err == nil
			if !deliveryReviewed {
				if _, err := tx.Exec(ctx,
					`INSERT INTO order_delivery_reviews (order_id, customer_id, rating, comment)
					 VALUES ($1, $2, $3, $4)`,
					*orderID, customerID, *deliveryRating, deliveryComment); err != nil {
					return err
				}
				deliveryReviewed = true
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"saved":            true,
		"deliveryReviewed": deliveryReviewed,
	})
	return nil
}
