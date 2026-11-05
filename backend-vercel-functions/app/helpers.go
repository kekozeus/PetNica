package app

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// readJSON replica express.json({ limit: '32kb' }).
func readJSON(r *http.Request, v any) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, 32*1024+1))
	if err != nil {
		return errf(http.StatusBadRequest, "El cuerpo de la solicitud no contiene JSON válido.")
	}
	if len(body) > 32*1024 {
		return errf(http.StatusRequestEntityTooLarge, "El cuerpo de la solicitud supera el límite permitido.")
	}
	if len(body) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, v); err != nil {
		return errf(http.StatusBadRequest, "El cuerpo de la solicitud no contiene JSON válido.")
	}
	return nil
}

// bigint serializa enteros BIGINT como string, igual que node-pg hace con int8.
type bigint int64

func (b bigint) MarshalJSON() ([]byte, error) {
	return strconv.AppendQuote(nil, strconv.FormatInt(int64(b), 10)), nil
}

func bigintPtr(v *int64) *bigint {
	if v == nil {
		return nil
	}
	b := bigint(*v)
	return &b
}
func requiredText(value string, label string, maxLength int) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || len(trimmed) > maxLength {
		return "", errf(http.StatusBadRequest, "%s es obligatorio y debe tener máximo %d caracteres.", label, maxLength)
	}
	return trimmed, nil
}

// requiredTextAny replica text() de admin-router.js sobre un valor JSON:
// solo strings son aceptados.
func requiredTextAny(value any, label string, maxLength int) (string, error) {
	s, ok := value.(string)
	if !ok {
		return "", errf(http.StatusBadRequest, "%s es obligatorio y debe tener máximo %d caracteres.", label, maxLength)
	}
	return requiredText(s, label, maxLength)
}

func optionalText(value *string, label string, maxLength int) (*string, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*value)
	if len(trimmed) > maxLength {
		return nil, errf(http.StatusBadRequest, "%s no puede superar %d caracteres.", label, maxLength)
	}
	return &trimmed, nil
}

// optionalTextAny replica optionalText() sobre un valor JSON cualquiera:
// null/undefined/"" → null; strings largos → error; no-string → error.
func optionalTextAny(value any, label string, maxLength int) (*string, error) {
	if value == nil {
		return nil, nil
	}
	s, ok := value.(string)
	if !ok {
		return nil, errf(http.StatusBadRequest, "%s no puede superar %d caracteres.", label, maxLength)
	}
	return optionalText(&s, label, maxLength)
}

// customerTextAny replica text() de customer-router.js (mensaje distinto).
func customerTextAny(value any, label string, maxLength int) (string, error) {
	s, ok := value.(string)
	if !ok || strings.TrimSpace(s) == "" || len(strings.TrimSpace(s)) > maxLength {
		return "", errf(http.StatusBadRequest, "%s es obligatorio (máximo %d caracteres).", label, maxLength)
	}
	return strings.TrimSpace(s), nil
}

func jsonString(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

func formatID(id int64) string {
	return strconv.FormatInt(id, 10)
}

func lower(s string) string { return strings.ToLower(s) }
func upper(s string) string { return strings.ToUpper(s) }

var digitsPattern = regexp.MustCompile(`^\d+$`)
var positiveIDPattern = regexp.MustCompile(`^[1-9]\d*$`)

// positiveID replica el positiveId de admin-router.js: String(value||”),
// solo dígitos y valor >= 1. Acepta números y strings.
func positiveID(value any, label string) (int64, error) {
	var str string
	switch t := value.(type) {
	case string:
		str = t
	case float64:
		str = strconv.FormatFloat(t, 'f', -1, 64)
	case nil:
		str = ""
	default:
		str = fmt.Sprintf("%v", t)
	}
	if !digitsPattern.MatchString(str) {
		return 0, errf(http.StatusBadRequest, "%s no es válido.", label)
	}
	id, err := strconv.ParseInt(str, 10, 64)
	if err != nil || id < 1 {
		return 0, errf(http.StatusBadRequest, "%s no es válido.", label)
	}
	return id, nil
}

// customerPositiveID replica el positiveId de customer-router.js: /^[1-9]\d*$/ y tope BIGINT.
func customerPositiveID(value any, label string) (int64, error) {
	var str string
	switch t := value.(type) {
	case string:
		str = t
	case float64:
		str = strconv.FormatFloat(t, 'f', -1, 64)
	default:
		return 0, errf(http.StatusBadRequest, "%s no es válido.", label)
	}
	if !positiveIDPattern.MatchString(str) {
		return 0, errf(http.StatusBadRequest, "%s no es válido.", label)
	}
	id, err := strconv.ParseInt(str, 10, 64)
	if err != nil {
		return 0, errf(http.StatusBadRequest, "%s no es válido.", label)
	}
	return id, nil
}

func nonNegativeNumber(value any, label string, integer bool, max float64) (float64, error) {
	var number float64
	switch t := value.(type) {
	case float64:
		number = t
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(t), 64)
		if err != nil {
			return 0, errf(http.StatusBadRequest, "%s debe ser un número válido.", label)
		}
		number = parsed
	case nil:
		return 0, errf(http.StatusBadRequest, "%s debe ser un número válido.", label)
	default:
		return 0, errf(http.StatusBadRequest, "%s debe ser un número válido.", label)
	}
	if math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || number > max || (integer && number != math.Trunc(number)) {
		return 0, errf(http.StatusBadRequest, "%s debe ser un número válido.", label)
	}
	return number, nil
}

// sameOrigin replica la comprobación de origen de los routers Node:
// el host del Origin debe coincidir con el header Host literal de la solicitud.
// Detrás de un proxy confiable (TRUST_PROXY o Vercel) también se acepta el
// primer valor de X-Forwarded-Host: al reescribir /api hacia otro proyecto
// Vercel, el backend recibe Host propio pero Origin del frontend.
func (a *App) sameOrigin(r *http.Request) error {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return errf(http.StatusForbidden, "Solicitud sin origen válido.")
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return errf(http.StatusForbidden, "Origen de solicitud no permitido.")
	}
	if parsed.Host == r.Host {
		return nil
	}
	if a.cfg.trustProxy || a.cfg.serverless {
		forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0])
		if forwarded != "" && parsed.Host == forwarded {
			return nil
		}
	}
	return errf(http.StatusForbidden, "Origen de solicitud no permitido.")
}

func safeEqual(left, right string) bool {
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func randHex(bytes int) string {
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return hex.EncodeToString(buf)
}

// newSessionID genera 24 caracteres base64url como uid(24) de express-session.
func newSessionID() string {
	buf := make([]byte, 18)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

func newUUID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		buf[0:4], buf[4:6], buf[6:8], buf[8:10], buf[10:16])
}

var (
	slugInvalidChars = regexp.MustCompile(`[^a-z0-9]+`)
	slugEdgeDashes   = regexp.MustCompile(`^-+|-+$`)
	slugValid        = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
)

// slugify replica el slugify de admin-router.js (NFKD, sin diacríticos,
// minúsculas, caracteres no alfanuméricos como guiones).
func slugify(value string) string {
	// Normaliza a forma descompuesta y elimina los diacríticos U+0300–U+036F.
	normalized, _, err := transform.String(
		transform.Chain(norm.NFD, runes.Remove(runes.Predicate(func(r rune) bool {
			return r >= 0x0300 && r <= 0x036F
		}))),
		value,
	)
	if err != nil {
		normalized = value
	}
	normalized = strings.ToLower(strings.TrimSpace(normalized))
	normalized = slugInvalidChars.ReplaceAllString(normalized, "-")
	return slugEdgeDashes.ReplaceAllString(normalized, "")
}

func fixedMoney(value float64) string {
	return fmt.Sprintf("%.2f", value)
}
