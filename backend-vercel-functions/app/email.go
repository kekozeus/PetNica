package app

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

//go:embed assets/email-logo.png
var emailLogoPNG []byte

// orderReceiptData es el contenido del comprobante que se envía por correo.
type orderReceiptData struct {
	OrderID         int64
	Items           []map[string]any
	Subtotal        string
	Discount        string
	Shipping        string
	Total           string
	ShippingAddress string
	PaymentMethod   string
}

// sendEmail envía un correo mediante la API HTTP de Resend.
// Si RESEND_API_KEY no está configurada, no hace nada (retorna nil).
func (a *App) sendEmail(ctx context.Context, to, subject, htmlBody string, attachments []map[string]any) error {
	if a.cfg.resendAPIKey == "" || to == "" {
		return nil
	}
	payload := map[string]any{
		"from":    a.cfg.resendFrom,
		"to":      []string{to},
		"subject": subject,
		"html":    htmlBody,
	}
	if len(attachments) > 0 {
		payload["attachments"] = attachments
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.cfg.resendAPIKey)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("resend respondió %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}
	return nil
}

func paymentMethodLabel(method string) string {
	switch method {
	case "efectivo_contra_entrega":
		return "Efectivo contra entrega"
	case "transferencia":
		return "Transferencia bancaria"
	default:
		return method
	}
}

// isZeroMoney detecta montos "0", "0.00", "C$ 0.00", etc.
func isZeroMoney(s string) bool {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "C$")
	s = strings.TrimSpace(s)
	for _, r := range s {
		if r != '0' && r != '.' && r != ',' {
			return false
		}
	}
	return true
}

// sendOrderReceipt construye y envía el comprobante del pedido al correo
// de la cuenta del cliente. Los errores los registra quien llama.
func (a *App) sendOrderReceipt(ctx context.Context, to, customerName string, order orderReceiptData) error {
	if a.cfg.resendAPIKey == "" || to == "" {
		return nil
	}
	money := func(value string) string { return "C$ " + value }

	var rows strings.Builder
	for _, item := range order.Items {
		name, _ := item["name"].(string)
		price, _ := item["price"].(string)
		quantity := int64(0)
		switch q := item["quantity"].(type) {
		case int64:
			quantity = q
		case float64:
			quantity = int64(q)
		}
		fmt.Fprintf(&rows,
			`<tr><td style="padding:11px 4px;border-bottom:1px solid #f0ece4;font-size:14px;color:#33475b">%s</td>`+
				`<td style="padding:11px 4px;border-bottom:1px solid #f0ece4;text-align:center;font-size:14px;color:#64748b;width:52px">%d</td>`+
				`<td style="padding:11px 4px;border-bottom:1px solid #f0ece4;text-align:right;font-size:14px;color:#26476e;font-weight:600;white-space:nowrap">%s</td></tr>`,
			html.EscapeString(name), quantity, html.EscapeString(money(price)))
	}

	greeting := "Hola"
	if customerName != "" {
		greeting += " " + html.EscapeString(customerName)
	}

	var discountRow string
	if !isZeroMoney(order.Discount) {
		discountRow = fmt.Sprintf(
			`<tr><td style="padding:3px 16px;font-size:14px;color:#64748b">Descuento</td>`+
				`<td style="padding:3px 16px;text-align:right;font-size:14px;color:#0e8a7d;font-weight:600">− %s</td></tr>`,
			html.EscapeString(money(order.Discount)))
	}
	shippingLabel := "Gratis"
	if !isZeroMoney(order.Shipping) {
		shippingLabel = html.EscapeString(money(order.Shipping))
	}

	var whatsappLink string
	if a.cfg.whatsapp != "" {
		text := url.QueryEscape(fmt.Sprintf("Hola PetNica, quiero coordinar la entrega de mi pedido #%d.", order.OrderID))
		whatsappLink = fmt.Sprintf(
			`<a href="https://wa.me/%s?text=%s" style="display:inline-block;background:#1fae54;color:#ffffff;`+
				`text-decoration:none;padding:12px 28px;border-radius:999px;font-weight:700;font-size:15px">Coordinar entrega por WhatsApp</a>`,
			url.QueryEscape(a.cfg.whatsapp), text)
	}

	body := fmt.Sprintf(`<div style="display:none;max-height:0;overflow:hidden">Confirmamos tu pedido #%d. Aquí está tu comprobante.</div>
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%%;background:#ffffff;border:1px solid #eae3d6;border-radius:16px;overflow:hidden;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#26476e">
	<tr><td style="background:#fdf7ec;padding:24px 28px 16px;text-align:center;border-bottom:1px solid #f0e7d4">
		<img src="cid:petnica-logo" width="170" alt="PetNica" style="display:inline-block;width:170px;max-width:170px;height:auto">
	</td></tr>
	<tr><td style="padding:26px 28px 6px;text-align:center">
		<p style="margin:0 0 12px"><span style="display:inline-block;background:#26476e;color:#ffffff;border-radius:999px;padding:4px 14px;font-size:13px;font-weight:600;letter-spacing:.03em">Pedido #%d</span></p>
		<h1 style="margin:0 0 8px;font-size:22px;color:#26476e;font-weight:800">¡Pedido confirmado!</h1>
		<p style="margin:0;font-size:15px;color:#64748b">%s, gracias por tu compra. Este es tu comprobante:</p>
	</td></tr>
	<tr><td style="padding:16px 28px 0">
		<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
			<thead><tr>
				<th style="padding:0 4px 8px;text-align:left;font-size:11px;color:#8aa0ae;text-transform:uppercase;letter-spacing:.08em;font-weight:700;border-bottom:2px solid #26476e">Producto</th>
				<th style="padding:0 4px 8px;text-align:center;font-size:11px;color:#8aa0ae;text-transform:uppercase;letter-spacing:.08em;font-weight:700;border-bottom:2px solid #26476e">Cant.</th>
				<th style="padding:0 4px 8px;text-align:right;font-size:11px;color:#8aa0ae;text-transform:uppercase;letter-spacing:.08em;font-weight:700;border-bottom:2px solid #26476e">Total</th>
			</tr></thead>
			<tbody>%s</tbody>
		</table>
	</td></tr>
	<tr><td style="padding:18px 28px 0">
		<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#f4faf8;border:1px solid #dcefe9;border-radius:12px">
			<tr><td style="padding:10px 16px 3px;font-size:14px;color:#64748b">Subtotal</td><td style="padding:10px 16px 3px;text-align:right;font-size:14px;color:#33475b">%s</td></tr>
			%s
			<tr><td style="padding:3px 16px;font-size:14px;color:#64748b">Envío</td><td style="padding:3px 16px;text-align:right;font-size:14px;color:#33475b">%s</td></tr>
			<tr><td style="padding:10px 16px 12px;font-size:17px;color:#26476e;font-weight:800">Total</td><td style="padding:10px 16px 12px;text-align:right;font-size:17px;color:#26476e;font-weight:800">%s</td></tr>
		</table>
	</td></tr>
	<tr><td style="padding:18px 28px 0">
		<p style="margin:0 0 3px;font-size:11px;color:#8aa0ae;text-transform:uppercase;letter-spacing:.08em;font-weight:700">Entrega</p>
		<p style="margin:0 0 14px;font-size:14px;color:#33475b">%s</p>
		<p style="margin:0 0 3px;font-size:11px;color:#8aa0ae;text-transform:uppercase;letter-spacing:.08em;font-weight:700">Método de pago</p>
		<p style="margin:0;font-size:14px;color:#33475b">%s</p>
	</td></tr>
	<tr><td style="padding:24px 28px 28px;text-align:center">%s</td></tr>
	<tr><td style="padding:16px 28px;border-top:1px solid #f0ece4;background:#fbfaf7">
		<p style="margin:0;font-size:11px;color:#9aa5ab;line-height:1.5;text-align:center">
			Comprobante informativo de pedido PetNica; no sustituye una factura fiscal.<br>
			Si tienes alguna duda sobre tu pedido, respóndenos por WhatsApp.
		</p>
	</td></tr>
</table>
<p style="margin:14px 0 0;text-align:center;font-size:11px;color:#a8a29a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">PetNica · Tienda para perros y gatos · Nicaragua</p>
</td></tr></table>`,
		order.OrderID, order.OrderID, greeting, rows.String(),
		html.EscapeString(money(order.Subtotal)),
		discountRow,
		shippingLabel,
		html.EscapeString(money(order.Total)),
		html.EscapeString(order.ShippingAddress),
		html.EscapeString(paymentMethodLabel(order.PaymentMethod)),
		whatsappLink)

	attachments := []map[string]any{{
		"filename":   "petnica-logo.png",
		"content":    base64.StdEncoding.EncodeToString(emailLogoPNG),
		"content_id": "petnica-logo",
	}}

	return a.sendEmail(ctx, to,
		fmt.Sprintf("PetNica — Pedido #%d confirmado", order.OrderID), body, attachments)
}
