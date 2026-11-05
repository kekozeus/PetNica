package app

import (
	"context"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// App concentra configuración, pool PostgreSQL y dependencias.
type App struct {
	cfg        config
	pool       *pgxpool.Pool
	sessions   *sessionStore
	images     *imageStorage
	httpClient *http.Client

	loginLimiter *rateLimiter
	authLimiter  *rateLimiter
	orderLimiter *rateLimiter

	mux      *http.ServeMux
	initMu   sync.Mutex
	initDone bool
}

// NewApp crea la aplicación completa (equivalente a server.js).
func NewApp(ctx context.Context) (*App, error) {
	cfg, err := loadConfig()
	if err != nil {
		return nil, err
	}
	pool, err := newPool(ctx, cfg)
	if err != nil {
		return nil, err
	}
	images, err := newImageStorage(cfg)
	if err != nil {
		return nil, err
	}
	a := &App{
		cfg:          cfg,
		pool:         pool,
		sessions:     newSessionStore(pool, cfg),
		images:       images,
		httpClient:   &http.Client{Timeout: 15 * time.Second},
		loginLimiter: newRateLimiter(cfg.trustProxy, 8),
		authLimiter:  newRateLimiter(cfg.trustProxy, 8),
		orderLimiter: newRateLimiter(cfg.trustProxy, 20),
	}
	a.registerRoutes()
	return a, nil
}

func (a *App) Close() {
	a.pool.Close()
}

func (a *App) registerRoutes() {
	mux := http.NewServeMux()

	// Catálogo público y pedidos
	mux.HandleFunc("GET /api/health", handle(a.health))
	mux.HandleFunc("GET /api/catalog", handle(a.catalog))
	mux.HandleFunc("GET /api/products/{productId}", handle(a.productDetail))
	mux.HandleFunc("POST /api/orders", handle(a.orderLimiter.middleware(a.createOrder)))

	// Administración
	mux.HandleFunc("GET /api/admin/session", handle(a.adminSession))
	mux.HandleFunc("POST /api/admin/login", handle(a.loginLimiter.middleware(a.adminLogin)))
	mux.HandleFunc("POST /api/admin/logout", handle(a.adminLogout))
	mux.HandleFunc("GET /api/admin/overview", handle(a.adminOverview))
	mux.HandleFunc("GET /api/admin/finances", handle(a.adminFinances))
	mux.HandleFunc("POST /api/admin/products", handle(a.adminCreateProduct))
	mux.HandleFunc("PUT /api/admin/products/{productId}", handle(a.adminUpdateProduct))
	mux.HandleFunc("POST /api/admin/products/{productId}/variants", handle(a.adminCreateVariant))
	mux.HandleFunc("PUT /api/admin/variants/{variantId}", handle(a.adminUpdateVariant))
	mux.HandleFunc("POST /api/admin/products/{productId}/image", handle(a.adminUploadProductImage))
	mux.HandleFunc("DELETE /api/admin/products/{productId}/image", handle(a.adminDeleteProductImage))
	mux.HandleFunc("PUT /api/admin/orders/{orderId}/status", handle(a.adminUpdateOrderStatus))
	mux.HandleFunc("PUT /api/admin/orders/{orderId}/payment", handle(a.adminUpdateOrderPayment))
	mux.HandleFunc("GET /api/admin/orders/{orderId}/delivery", handle(a.adminOrderDelivery))
	mux.HandleFunc("GET /api/admin/couriers", handle(a.adminCouriers))
	mux.HandleFunc("POST /api/admin/couriers", handle(a.adminCreateCourier))
	mux.HandleFunc("PUT /api/admin/couriers/{courierId}/password", handle(a.adminUpdateCourierPassword))

	// Repartidores
	mux.HandleFunc("GET /api/delivery/session", handle(a.deliverySession))
	mux.HandleFunc("POST /api/delivery/login", handle(a.loginLimiter.middleware(a.deliveryLogin)))
	mux.HandleFunc("POST /api/delivery/logout", handle(a.deliveryLogout))
	mux.HandleFunc("GET /api/delivery/orders", handle(a.deliveryOrders))
	mux.HandleFunc("PUT /api/delivery/orders/{orderId}/status", handle(a.deliveryUpdateStatus))
	mux.HandleFunc("POST /api/delivery/orders/{orderId}/video-url", handle(a.deliveryVideoURL))
	mux.HandleFunc("POST /api/delivery/orders/{orderId}/video", handle(a.deliveryVideoUpload))
	mux.HandleFunc("POST /api/delivery/orders/{orderId}/proof", handle(a.deliveryProof))

	// Cuenta de cliente
	mux.HandleFunc("GET /api/account/google", handle(a.googleAuthURL))
	mux.HandleFunc("GET /api/account/google/callback", handle(a.googleCallback))
	mux.HandleFunc("GET /api/account/session", handle(a.customerSession))
	mux.HandleFunc("POST /api/account/register", handle(a.authLimiter.middleware(a.customerRegister)))
	mux.HandleFunc("POST /api/account/login", handle(a.authLimiter.middleware(a.customerLogin)))
	mux.HandleFunc("POST /api/account/logout", handle(a.customerLogout))
	mux.HandleFunc("GET /api/account/cart", handle(a.customerGetCart))
	mux.HandleFunc("PUT /api/account/cart", handle(a.customerPutCart))
	mux.HandleFunc("GET /api/account/orders", handle(a.customerOrders))
	mux.HandleFunc("POST /api/account/reviews", handle(a.customerReviews))

	// Imágenes locales (dev); en Vercel las sirve public/ como estáticos.
	mux.HandleFunc("GET /images/{file...}", a.serveImage)

	a.mux = mux
}

// setSecurityHeaders aplica cabeceras de endurecimiento comunes a toda
// respuesta del API, incluidos los errores tempranos de inicialización.
func (a *App) setSecurityHeaders(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	h.Set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=()")
	if r.TLS != nil || a.cfg.serverless || (a.cfg.trustProxy && r.Header.Get("X-Forwarded-Proto") == "https") {
		h.Set("Strict-Transport-Security", "max-age=15552000; includeSubDomains")
	}
	// Respuestas ligadas a la sesión o a datos privados nunca deben quedar
	// en cachés intermedios ni del navegador.
	path := r.URL.Path
	if strings.HasPrefix(path, "/api/account/") || strings.HasPrefix(path, "/api/admin/") || path == "/api/orders" {
		h.Set("Cache-Control", "no-store")
	}
}

// ServeHTTP inicializa la base de datos una vez por instancia y atiende
// la solicitud; replica api/route.js.
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	a.setSecurityHeaders(w, r)
	if err := a.initialize(r.Context()); err != nil {
		log.Printf("No se pudo preparar la base de datos de PetNica: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "El backend no está disponible por un problema de configuración o base de datos.",
		})
		return
	}
	a.sessionMiddleware(a.mux).ServeHTTP(w, r)
}

// --- guardas compartidas ---------------------------------------------------

func (a *App) requireAdmin(r *http.Request) (*session, error) {
	s, err := a.session(r)
	if err != nil {
		return nil, err
	}
	if s.data.Admin == nil || s.data.Admin.Role == "repartidor" {
		return nil, errf(http.StatusUnauthorized, "Inicia sesión para continuar.")
	}
	return s, nil
}

// requireCourier exige una sesión de repartidor (rol 'repartidor').
func (a *App) requireCourier(r *http.Request) (*session, error) {
	s, err := a.session(r)
	if err != nil {
		return nil, err
	}
	if s.data.Admin == nil || s.data.Admin.Role != "repartidor" {
		return nil, errf(http.StatusUnauthorized, "Inicia sesión como repartidor para continuar.")
	}
	return s, nil
}

func (a *App) requireAdminCSRF(r *http.Request, s *session) error {
	if err := a.sameOrigin(r); err != nil {
		return err
	}
	token := r.Header.Get("x-csrf-token")
	expected := s.data.CsrfToken
	if token == "" || expected == "" {
		return errf(http.StatusForbidden, "La sesión expiró. Inicia sesión de nuevo.")
	}
	if !safeEqual(token, expected) {
		return errf(http.StatusForbidden, "La sesión expiró. Actualiza la página e inténtalo de nuevo.")
	}
	return nil
}

func (a *App) requireCustomer(r *http.Request) (*session, error) {
	s, err := a.session(r)
	if err != nil {
		return nil, err
	}
	if s.data.Customer == nil {
		return nil, errf(http.StatusUnauthorized, "Inicia sesión para continuar.")
	}
	return s, nil
}

func (a *App) requireCustomerCSRF(r *http.Request, s *session) error {
	if err := a.sameOrigin(r); err != nil {
		return err
	}
	token := r.Header.Get("x-csrf-token")
	expected := s.data.CustomerCsrfToken
	if token == "" || expected == "" {
		return errf(http.StatusForbidden, "La sesión expiró. Actualiza la página e inténtalo de nuevo.")
	}
	if !safeEqual(token, expected) {
		return errf(http.StatusForbidden, "La sesión expiró. Actualiza la página e inténtalo de nuevo.")
	}
	return nil
}
