package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	sessionCookieName = "petnica.sid"
	sessionMaxAge     = 8 * 60 * 60 // 8 horas, igual que el backend Node
)

// sessionData reproduce la forma del JSON que express-session guarda
// en la columna sess de petnica_sessions.
type sessionData struct {
	Admin             *adminIdentity    `json:"admin,omitempty"`
	CsrfToken         string            `json:"csrfToken,omitempty"`
	Customer          *customerIdentity `json:"customer,omitempty"`
	CustomerCsrfToken string            `json:"customerCsrfToken,omitempty"`
	GoogleOAuth       *oauthState       `json:"googleOAuth,omitempty"`
}

type adminIdentity struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Role  string `json:"role,omitempty"`
}

type customerIdentity struct {
	ID string `json:"id"`
}

type oauthState struct {
	State string `json:"state"`
	Nonce string `json:"nonce"`
}

// session es el equivalente de req.session en Express.
type session struct {
	id        string
	data      sessionData
	loaded    bool // existía en el almacén
	dirty     bool
	destroyed bool
	accessed  bool // algún handler leyó la sesión
	oldID     string
}

func (s *session) empty() bool {
	d := s.data
	return d.Admin == nil && d.CsrfToken == "" && d.Customer == nil && d.CustomerCsrfToken == "" && d.GoogleOAuth == nil
}

// regenerate replica request.session.regenerate: destruye la sesión
// anterior y empieza una nueva con otro id.
func (s *session) regenerate() {
	if s.id != "" && s.loaded {
		s.oldID = s.id
	}
	s.id = newSessionID()
	s.data = sessionData{}
	s.loaded = false
	s.dirty = true
	s.destroyed = false
}

// destroy replica request.session.destroy.
func (s *session) destroy() {
	s.destroyed = true
	s.dirty = true
}

// sessionStore implementa la persistencia en petnica_sessions con el
// mismo formato de connect-pg-simple (sid firmado + TO_TIMESTAMP).
type sessionStore struct {
	pool       *pgxpool.Pool
	secret     string
	trust      bool
	serverless bool
	tableName  string
}

func newSessionStore(pool *pgxpool.Pool, cfg config) *sessionStore {
	return &sessionStore{pool: pool, secret: cfg.sessionSecret, trust: cfg.trustProxy, serverless: cfg.serverless, tableName: "petnica_sessions"}
}

func (st *sessionStore) sign(sid string) string {
	mac := hmac.New(sha256.New, []byte(st.secret))
	mac.Write([]byte(sid))
	return base64.StdEncoding.WithPadding(base64.NoPadding).EncodeToString(mac.Sum(nil))
}

func (st *sessionStore) secureCookie(r *http.Request) bool {
	// En Vercel toda la salida es HTTPS, así que la cookie siempre es Secure.
	if r.TLS != nil || st.serverless {
		return true
	}
	return st.trust && r.Header.Get("X-Forwarded-Proto") == "https"
}

// loadSession lee y verifica la cookie firmada, igual que
// cookie-signature + express-session lo hacen en Node.
func (st *sessionStore) loadSession(ctx context.Context, r *http.Request) (*session, error) {
	s := &session{}
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return s, nil
	}
	value, err := url.QueryUnescape(cookie.Value)
	if err != nil {
		value = cookie.Value
	}
	if !strings.HasPrefix(value, "s:") {
		return s, nil
	}
	signed := value[2:]
	dot := strings.LastIndex(signed, ".")
	if dot <= 0 {
		return s, nil
	}
	sid, sig := signed[:dot], signed[dot+1:]
	expected := st.sign(sid)
	if subtle.ConstantTimeCompare([]byte(sig), []byte(expected)) != 1 {
		return s, nil
	}

	var raw []byte
	err = st.pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT sess FROM %s WHERE sid = $1 AND expire >= TO_TIMESTAMP($2)`, st.tableName),
		sid, float64(time.Now().Unix()),
	).Scan(&raw)
	if err != nil {
		if err == pgx.ErrNoRows {
			return s, nil // sesión expirada o inexistente: se inicia una vacía
		}
		return nil, err
	}
	s.id = sid
	s.loaded = true
	_ = json.Unmarshal(raw, &s.data)
	return s, nil
}

func (st *sessionStore) saveSession(ctx context.Context, s *session, secure bool) error {
	expires := time.Now().Add(sessionMaxAge * time.Second)
	cookieJSON := map[string]any{
		"originalMaxAge": sessionMaxAge * 1000,
		"expires":        expires.UTC().Format("2006-01-02T15:04:05.000Z07:00"),
		"secure":         secure,
		"httpOnly":       true,
		"path":           "/",
		"sameSite":       "lax",
	}
	payload := map[string]any{"cookie": cookieJSON}
	raw, err := json.Marshal(s.data)
	if err != nil {
		return err
	}
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	for k, v := range fields {
		payload[k] = v
	}
	sess, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if s.oldID != "" {
		_, _ = st.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE sid = $1`, st.tableName), s.oldID)
		s.oldID = ""
	}
	_, err = st.pool.Exec(ctx, fmt.Sprintf(`
		INSERT INTO %s (sess, expire, sid) VALUES ($1, TO_TIMESTAMP($2), $3)
		ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
		st.tableName), string(sess), float64(expires.Unix()), s.id)
	return err
}

func (st *sessionStore) destroySession(ctx context.Context, s *session) error {
	ids := []string{}
	if s.id != "" {
		ids = append(ids, s.id)
	}
	if s.oldID != "" {
		ids = append(ids, s.oldID)
	}
	for _, id := range ids {
		if _, err := st.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE sid = $1`, st.tableName), id); err != nil {
			return err
		}
	}
	return nil
}

func (st *sessionStore) writeCookie(w http.ResponseWriter, s *session, secure bool) {
	value := url.QueryEscape("s:" + s.id + "." + st.sign(s.id))
	expires := time.Now().Add(sessionMaxAge * time.Second)
	var b strings.Builder
	fmt.Fprintf(&b, "%s=%s; Path=/; Expires=%s; Max-Age=%d; HttpOnly",
		sessionCookieName, value, expires.UTC().Format(http.TimeFormat), sessionMaxAge)
	if secure {
		b.WriteString("; Secure")
	}
	b.WriteString("; SameSite=Lax")
	w.Header().Add("Set-Cookie", b.String())
}

func (st *sessionStore) clearCookie(w http.ResponseWriter, secure bool) {
	var b strings.Builder
	fmt.Fprintf(&b, "%s=; Path=/; Expires=%s; HttpOnly",
		sessionCookieName, time.Unix(0, 0).UTC().Format(http.TimeFormat))
	if secure {
		b.WriteString("; Secure")
	}
	b.WriteString("; SameSite=Lax")
	w.Header().Add("Set-Cookie", b.String())
}

// --- Middleware y contexto ------------------------------------------------

type sessionContextKey struct{}

type sessionRef struct {
	sess    *session
	fetched bool
}

// sessionWriter intercepta el primer WriteHeader para persistir la sesión
// y adjuntar la cookie antes de que se envíen los encabezados.
type sessionWriter struct {
	http.ResponseWriter
	app         *App
	request     *http.Request
	wroteHeader bool
}

func (sw *sessionWriter) commit() {
	if sw.wroteHeader {
		return
	}
	sw.wroteHeader = true
	ref, _ := sw.request.Context().Value(sessionContextKey{}).(*sessionRef)
	if ref == nil || !ref.fetched || ref.sess == nil || !ref.sess.accessed {
		return
	}
	s := ref.sess
	ctx := sw.request.Context()
	if s.destroyed {
		if err := sw.app.sessions.destroySession(ctx, s); err != nil {
			fmt.Printf("No se pudo destruir la sesión: %v\n", err)
		}
		sw.app.sessions.clearCookie(sw.ResponseWriter, sw.app.sessions.secureCookie(sw.request))
		return
	}
	if s.id == "" {
		s.id = newSessionID()
	}
	// rolling: true → se regraba y renueva la cookie en cada respuesta,
	// salvo para sesiones nuevas completamente vacías (saveUninitialized: false).
	if !s.loaded && !s.dirty && s.empty() {
		return
	}
	if err := sw.app.sessions.saveSession(ctx, s, sw.app.sessions.secureCookie(sw.request)); err != nil {
		fmt.Printf("No se pudo guardar la sesión: %v\n", err)
	}
	sw.app.sessions.writeCookie(sw.ResponseWriter, s, sw.app.sessions.secureCookie(sw.request))
}

func (sw *sessionWriter) WriteHeader(code int) {
	sw.commit()
	sw.ResponseWriter.WriteHeader(code)
}

func (sw *sessionWriter) Write(b []byte) (int, error) {
	sw.commit()
	return sw.ResponseWriter.Write(b)
}

func (sw *sessionWriter) Flush() {
	sw.commit()
	if f, ok := sw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// sessionMiddleware envuelve el mux entero: carga perezosa + commit al final.
func (a *App) sessionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sw := &sessionWriter{ResponseWriter: w, app: a, request: r}
		ctx := context.WithValue(r.Context(), sessionContextKey{}, &sessionRef{})
		r = r.WithContext(ctx)
		sw.request = r
		next.ServeHTTP(sw, r)
		sw.commit() // por si el handler no escribió nada
	})
}

// session obtiene (cargando perezosamente) la sesión de la solicitud.
func (a *App) session(r *http.Request) (*session, error) {
	ref := r.Context().Value(sessionContextKey{}).(*sessionRef)
	if !ref.fetched {
		ref.fetched = true
		sess, err := a.sessions.loadSession(r.Context(), r)
		if err != nil {
			return nil, err
		}
		sess.accessed = true
		ref.sess = sess
	}
	return ref.sess, nil
}

// customerID devuelve el id del cliente autenticado o "".
func (a *App) customerID(r *http.Request) (string, error) {
	s, err := a.session(r)
	if err != nil || s.data.Customer == nil {
		return "", err
	}
	return s.data.Customer.ID, nil
}
