package app

import (
	"fmt"
	"log"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

type orderItemInput struct {
	VariantID any `json:"variantId"`
	Quantity  any `json:"quantity"`
}

type petboxInput struct {
	PlanID  any     `json:"planId"`
	PetName string  `json:"petName"`
	Size    *string `json:"size"`
}

type orderRequest struct {
	Phone         *string          `json:"phone"`
	Neighborhood  string           `json:"neighborhood"`
	Reference     string           `json:"reference"`
	ZoneID        any              `json:"zoneId"`
	PaymentMethod string           `json:"paymentMethod"`
	Items         []orderItemInput `json:"items"`
	Petbox        *petboxInput     `json:"petbox"`
	PromoCode     any              `json:"promoCode"`
	TermsAccepted bool             `json:"termsAccepted"`
}

var orderIDStringPattern = regexp.MustCompile(`^\d+$`)

func integerParam(value any) (int64, bool) {
	switch t := value.(type) {
	case float64:
		if t == math.Trunc(t) && !math.IsInf(t, 0) {
			return int64(t), true
		}
	case string:
		if n, err := strconv.ParseInt(strings.TrimSpace(t), 10, 64); err == nil {
			return n, true
		}
	}
	return 0, false
}

func variantKey(value any) string {
	switch t := value.(type) {
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case string:
		return t
	default:
		return ""
	}
}

// truthy reproduce la semántica de verdad de JavaScript para valores JSON.
func truthy(value any) bool {
	switch t := value.(type) {
	case nil:
		return false
	case bool:
		return t
	case float64:
		return t != 0
	case string:
		return t != ""
	default:
		return true
	}
}

type orderLine struct {
	variantID    int64
	name         string
	presentation string
	price        float64
	quantity     int64
}

func (a *App) createOrder(w http.ResponseWriter, r *http.Request) error {
	s, err := a.session(r)
	if err != nil {
		return err
	}
	if s.data.Customer == nil {
		return errf(http.StatusUnauthorized, "Inicia sesión para confirmar tu pedido.")
	}
	if err := a.requireCustomerCSRF(r, s); err != nil {
		return err
	}
	customerID := s.data.Customer.ID

	var req orderRequest
	if err := readJSON(r, &req); err != nil {
		return err
	}

	phone, err := optionalText(req.Phone, "El WhatsApp", 20)
	if err != nil {
		return err
	}
	neighborhood, err := requiredText(req.Neighborhood, "El barrio o residencial", 100)
	if err != nil {
		return err
	}
	reference, err := requiredText(req.Reference, "La referencia", 2000)
	if err != nil {
		return err
	}
	zoneID, ok := integerParam(req.ZoneID)
	if !ok {
		return errf(http.StatusBadRequest, "Revisa la zona de entrega y los productos del carrito.")
	}
	if req.Items == nil {
		req.Items = []orderItemInput{}
	}
	if len(req.Items) > 50 {
		return errf(http.StatusBadRequest, "Revisa la zona de entrega y los productos del carrito.")
	}
	if req.PaymentMethod != "efectivo_contra_entrega" && req.PaymentMethod != "transferencia" {
		return errf(http.StatusBadRequest, "Selecciona un método de pago válido.")
	}
	if len(req.Items) == 0 && req.Petbox == nil {
		return errf(http.StatusBadRequest, "Agrega al menos un producto o una PetBox.")
	}

	var promoCode *string
	if req.PromoCode != nil {
		// Replica `request.body.promoCode ? requiredText(...) : null`:
		// cualquier valor truthy pasa por la validación.
		s, isString := req.PromoCode.(string)
		if !isString {
			if truthy(req.PromoCode) {
				return errf(http.StatusBadRequest, "El código promocional es obligatorio y debe tener máximo 30 caracteres.")
			}
		} else if s != "" {
			code, err := requiredText(s, "El código promocional", 30)
			if err != nil {
				return err
			}
			upper := strings.ToUpper(code)
			promoCode = &upper
		}
	}

	// Cantidades agregadas por variante, conservando el orden del carrito.
	quantities := map[string]int64{}
	var order []string
	for _, item := range req.Items {
		variantID := ""
		if truthy(item.VariantID) {
			variantID = variantKey(item.VariantID)
		}
		quantity, isInt := integerParam(item.Quantity)
		if !orderIDStringPattern.MatchString(variantID) || !isInt || quantity < 1 || quantity > 99 {
			return errf(http.StatusBadRequest, "Hay un producto o una cantidad inválida en el carrito.")
		}
		if _, seen := quantities[variantID]; !seen {
			order = append(order, variantID)
		}
		quantities[variantID] += quantity
		if quantities[variantID] > 99 {
			return errf(http.StatusBadRequest, "La cantidad máxima por producto es 99 unidades.")
		}
	}

	type response struct {
		OrderID         bigint           `json:"orderId"`
		Subtotal        string           `json:"subtotal"`
		Discount        string           `json:"discount"`
		Shipping        string           `json:"shipping"`
		Total           string           `json:"total"`
		ShippingAddress string           `json:"shippingAddress"`
		Whatsapp        string           `json:"whatsapp"`
		Items           []map[string]any `json:"items"`
	}
	var out response
	var txErr error
	var customerEmail, customerFirstName string

	txErr = a.withTransaction(r.Context(), func(tx pgx.Tx) error {
		ctx := r.Context()
		var zone struct {
			id       int64
			district string
			fee      float64
		}
		err := tx.QueryRow(ctx,
			`SELECT zone_id, district, shipping_fee_nio FROM delivery_zones WHERE zone_id = $1 AND is_active FOR SHARE`,
			zoneID).Scan(&zone.id, &zone.district, &zone.fee)
		if err == pgx.ErrNoRows {
			return errf(http.StatusBadRequest, "La zona de entrega seleccionada no está disponible.")
		}
		if err != nil {
			return err
		}

		var updated int64
		err = tx.QueryRow(ctx,
			`UPDATE customers SET phone_whatsapp = $1 WHERE customer_id = $2
			 RETURNING customer_id, email, first_name`,
			phone, customerID).Scan(&updated, &customerEmail, &customerFirstName)
		if err == pgx.ErrNoRows {
			return errf(http.StatusUnauthorized, "No se encontró la cuenta conectada. Inicia sesión de nuevo.")
		}
		if err != nil {
			return err
		}

		var addressID int64
		err = tx.QueryRow(ctx,
			`INSERT INTO addresses (customer_id, label, zone_id, neighborhood, landmark_reference, contact_phone)
			 VALUES ($1, 'Entrega web', $2, $3, $4, $5) RETURNING address_id`,
			customerID, zone.id, neighborhood, reference, phone).Scan(&addressID)
		if err != nil {
			return err
		}
		shippingAddress := fmt.Sprintf("%s · %s · %s", zone.district, neighborhood, reference)

		var subtotalCents int64
		var lines []orderLine
		for _, variantKeyStr := range order {
			quantity := quantities[variantKeyStr]
			var line orderLine
			var productID int64
			var stock int64
			err := tx.QueryRow(ctx,
				`SELECT v.variant_id, v.product_id, v.presentation, v.price_nio, v.stock_qty, p.name
				 FROM product_variants v
				 JOIN products p ON p.product_id = v.product_id
				 WHERE v.variant_id = $1 AND v.is_active AND p.is_active
				 FOR UPDATE OF v`, variantKeyStr).
				Scan(&line.variantID, &productID, &line.presentation, &line.price, &stock, &line.name)
			if err == pgx.ErrNoRows {
				return errf(http.StatusConflict, "Uno de los productos ya no está disponible.")
			}
			if err != nil {
				return err
			}
			if stock < quantity {
				return errf(http.StatusConflict,
					"No hay suficiente inventario de %s (%s).", line.name, line.presentation)
			}
			line.quantity = quantity
			subtotalCents += int64(math.Round(line.price*100)) * quantity
			lines = append(lines, line)
		}

		var subscriptionID *int64
		var petboxName string
		var petboxPrice float64
		if req.Petbox != nil {
			planIDStr := ""
			if truthy(req.Petbox.PlanID) {
				planIDStr = variantKey(req.Petbox.PlanID)
			}
			if !orderIDStringPattern.MatchString(planIDStr) {
				return errf(http.StatusBadRequest, "Selecciona un plan PetBox válido.")
			}
			var plan struct {
				id      int64
				name    string
				species string
				size    *string
				price   float64
			}
			err := tx.QueryRow(ctx,
				`SELECT plan_id, name, species, size, monthly_price_nio
				 FROM petbox_plans WHERE plan_id = $1 AND is_active FOR SHARE`, planIDStr).
				Scan(&plan.id, &plan.name, &plan.species, &plan.size, &plan.price)
			if err == pgx.ErrNoRows {
				return errf(http.StatusConflict, "El plan PetBox seleccionado ya no está disponible.")
			}
			if err != nil {
				return err
			}
			petName, err := requiredText(req.Petbox.PetName, "El nombre de tu mascota", 80)
			if err != nil {
				return err
			}
			var size *string
			if req.Petbox.Size != nil && *req.Petbox.Size != "" {
				size = req.Petbox.Size
			}
			validSizes := map[string]bool{"pequeño": true, "mediano": true, "grande": true}
			if plan.species != "gato" && (size == nil || !validSizes[*size]) {
				return errf(http.StatusBadRequest, "Selecciona el tamaño de tu perro para su PetBox.")
			}
			if plan.species == "perro" && (plan.size == nil || size == nil || *plan.size != *size) {
				return errf(http.StatusBadRequest, "El tamaño de tu mascota no coincide con el plan PetBox seleccionado.")
			}
			var petSize *string
			if plan.species != "gato" {
				petSize = size
			}

			var petID int64
			err = tx.QueryRow(ctx,
				`SELECT pet_id FROM pets
				 WHERE customer_id = $1 AND name = $2 AND species = $3
				   AND size IS NOT DISTINCT FROM $4::varchar
				 ORDER BY pet_id LIMIT 1`,
				customerID, petName, plan.species, petSize).Scan(&petID)
			if err == pgx.ErrNoRows {
				err = tx.QueryRow(ctx,
					`INSERT INTO pets (customer_id, name, species, size) VALUES ($1, $2, $3, $4) RETURNING pet_id`,
					customerID, petName, plan.species, petSize).Scan(&petID)
			}
			if err != nil {
				return err
			}

			var subID int64
			err = tx.QueryRow(ctx,
				`INSERT INTO petbox_subscriptions
				   (customer_id, pet_id, plan_id, address_id, delivery_day, next_delivery)
				 VALUES ($1, $2, $3, $4, 15, CURRENT_DATE + INTERVAL '1 month')
				 RETURNING subscription_id`,
				customerID, petID, plan.id, addressID).Scan(&subID)
			if err != nil {
				return err
			}
			subscriptionID = &subID
			petboxName = plan.name
			petboxPrice = plan.price
			subtotalCents += int64(math.Round(petboxPrice * 100))
		}

		var codeID *int64
		var discountCents int64
		if promoCode != nil {
			var code struct {
				id             int64
				discountType   string
				value          float64
				minPurchase    float64
				maxUses        *int64
				timesUsed      int64
				firstOrderOnly bool
			}
			err := tx.QueryRow(ctx,
				`SELECT code_id, discount_type, value, min_purchase_nio, max_uses, times_used,
				        first_order_only
				 FROM discount_codes
				 WHERE code = $1 AND is_active
				   AND (starts_at IS NULL OR starts_at <= now())
				   AND (ends_at IS NULL OR ends_at >= now())
				   AND (max_uses IS NULL OR times_used < max_uses)
				 FOR UPDATE`, *promoCode).
				Scan(&code.id, &code.discountType, &code.value, &code.minPurchase,
					&code.maxUses, &code.timesUsed, &code.firstOrderOnly)
			if err != nil && err != pgx.ErrNoRows {
				return err
			}
			invalid := err == pgx.ErrNoRows
			if !invalid && subtotalCents < int64(math.Round(code.minPurchase*100)) {
				invalid = true
			}
			if !invalid && code.firstOrderOnly {
				var prior int
				err = tx.QueryRow(ctx,
					`SELECT 1 FROM orders WHERE customer_id = $1 AND status <> 'cancelado' LIMIT 1`,
					customerID).Scan(&prior)
				if err != nil && err != pgx.ErrNoRows {
					return err
				}
				if err == nil {
					invalid = true
				}
			}
			if invalid {
				return errf(http.StatusBadRequest, "El código no es válido para este pedido.")
			}
			codeID = &code.id
			if code.discountType == "percent" {
				discountCents = int64(math.Round(float64(subtotalCents) * code.value / 100))
				if discountCents > subtotalCents {
					discountCents = subtotalCents
				}
			} else {
				discountCents = int64(math.Round(code.value * 100))
				if discountCents > subtotalCents {
					discountCents = subtotalCents
				}
			}
		}

		subtotal := float64(subtotalCents) / 100
		discount := float64(discountCents) / 100
		shippingCents := int64(math.Round(zone.fee * 100))
		shipping := float64(shippingCents) / 100
		total := float64(subtotalCents-discountCents+shippingCents) / 100

		var orderID int64
		err = tx.QueryRow(ctx,
			`INSERT INTO orders
			   (customer_id, address_id, shipping_address, petbox_subscription_id, code_id,
			    status, source_channel, payment_method, subtotal_nio, discount_nio, shipping_nio, total_nio)
			 VALUES ($1, $2, $3, $4, $5, 'pendiente', 'web', $6, $7, $8, $9, $10)
			 RETURNING order_id`,
			customerID, addressID, shippingAddress, subscriptionID, codeID,
			req.PaymentMethod, subtotal, discount, shipping, total).Scan(&orderID)
		if err != nil {
			return err
		}

		for _, line := range lines {
			if _, err := tx.Exec(ctx,
				`INSERT INTO order_items (order_id, variant_id, product_name, unit_price_nio, quantity)
				 VALUES ($1, $2, $3, $4, $5)`,
				orderID, line.variantID, line.name+" - "+line.presentation, line.price, line.quantity); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx,
				`UPDATE product_variants SET stock_qty = stock_qty - $1 WHERE variant_id = $2`,
				line.quantity, line.variantID); err != nil {
				return err
			}
		}
		if req.PaymentMethod == "transferencia" {
			if _, err := tx.Exec(ctx,
				`INSERT INTO payments (order_id, method, status, amount_nio)
				 VALUES ($1, $2, 'pendiente', $3)`,
				orderID, req.PaymentMethod, total); err != nil {
				return err
			}
		}
		if codeID != nil {
			if _, err := tx.Exec(ctx,
				`UPDATE discount_codes SET times_used = times_used + 1 WHERE code_id = $1`, *codeID); err != nil {
				return err
			}
		}
		if req.TermsAccepted {
			if _, err := tx.Exec(ctx,
				`UPDATE customers SET terms_accepted_at = COALESCE(terms_accepted_at, now())
				 WHERE customer_id = $1`, customerID); err != nil {
				return err
			}
		}
		var cartID *int64
		err = tx.QueryRow(ctx, `SELECT cart_id FROM carts WHERE customer_id = $1`, customerID).Scan(&cartID)
		if err != nil && err != pgx.ErrNoRows {
			return err
		}
		if cartID != nil {
			if _, err := tx.Exec(ctx, `DELETE FROM cart_items WHERE cart_id = $1`, *cartID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM cart_petbox_items WHERE cart_id = $1`, *cartID); err != nil {
				return err
			}
		}

		out.OrderID = bigint(orderID)
		out.Subtotal = fixedMoney(subtotal)
		out.Discount = fixedMoney(discount)
		out.Shipping = fixedMoney(shipping)
		out.Total = fixedMoney(total)
		out.ShippingAddress = shippingAddress
		out.Whatsapp = a.cfg.whatsapp
		out.Items = []map[string]any{}
		for _, line := range lines {
			out.Items = append(out.Items, map[string]any{
				"name":     line.name + " - " + line.presentation,
				"quantity": line.quantity,
				"price":    fixedMoney(line.price * float64(line.quantity)),
			})
		}
		if petboxName != "" {
			out.Items = append(out.Items, map[string]any{
				"name":     petboxName,
				"quantity": 1,
				"price":    fixedMoney(petboxPrice),
			})
		}
		return nil
	})
	if txErr != nil {
		return txErr
	}

	receipt := orderReceiptData{
		OrderID:         int64(out.OrderID),
		Items:           out.Items,
		Subtotal:        out.Subtotal,
		Discount:        out.Discount,
		Shipping:        out.Shipping,
		Total:           out.Total,
		ShippingAddress: out.ShippingAddress,
		PaymentMethod:   req.PaymentMethod,
	}
	if err := a.sendOrderReceipt(r.Context(), customerEmail, customerFirstName, receipt); err != nil {
		log.Printf("No se pudo enviar el comprobante del pedido %d: %v", out.OrderID, err)
	}

	writeJSON(w, http.StatusCreated, out)
	return nil
}
