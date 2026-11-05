package app

import (
	"fmt"
	"log"
	"os"
	"strings"
)

type config struct {
	port          string
	databaseURL   string
	pgssl         bool
	sessionSecret string
	trustProxy    bool
	whatsapp      string

	imageStorageMode string
	imageDir         string
	supabaseURL      string
	supabaseKey      string
	supabaseBucket   string
	supabasePrefix   string
	deliveryBucket   string

	googleClientID     string
	googleClientSecret string
	googleCallbackURL  string

	resendAPIKey string
	resendFrom   string

	serverless bool
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func loadConfig() (config, error) {
	cfg := config{
		port:          envOr("PORT", "3000"),
		databaseURL:   os.Getenv("DATABASE_URL"),
		pgssl:         os.Getenv("PGSSL") == "true",
		sessionSecret: os.Getenv("SESSION_SECRET"),
		trustProxy:    os.Getenv("TRUST_PROXY") == "true",
		whatsapp:      os.Getenv("WHATSAPP_NUMBER"),
		serverless:    os.Getenv("VERCEL") != "",
	}

	if cfg.sessionSecret == "" {
		if cfg.serverless || os.Getenv("NODE_ENV") == "production" {
			return cfg, fmt.Errorf("configura SESSION_SECRET con un valor aleatorio antes de iniciar en producción")
		}
		cfg.sessionSecret = randHex(48)
		log.Println("SESSION_SECRET no configurado: las sesiones se invalidarán al reiniciar.")
	}

	cfg.imageStorageMode = strings.ToLower(envOr("PRODUCT_IMAGE_STORAGE", "auto"))
	if cfg.imageStorageMode != "auto" && cfg.imageStorageMode != "local" && cfg.imageStorageMode != "supabase" {
		return cfg, fmt.Errorf("PRODUCT_IMAGE_STORAGE debe ser auto, local o supabase")
	}
	cfg.supabaseURL = strings.TrimRight(strings.TrimSpace(os.Getenv("SUPABASE_URL")), "/")
	cfg.supabaseKey = os.Getenv("SUPABASE_SECRET_KEY")
	if cfg.supabaseKey == "" {
		cfg.supabaseKey = os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	}
	cfg.supabaseBucket = envOr("SUPABASE_STORAGE_BUCKET", "product-images")
	cfg.supabasePrefix = envOr("SUPABASE_PRODUCT_IMAGE_PREFIX", "products")
	cfg.deliveryBucket = envOr("SUPABASE_DELIVERY_BUCKET", "order-deliveries")
	cfg.imageDir = os.Getenv("PRODUCT_IMAGE_DIR")

	cfg.googleClientID = os.Getenv("GOOGLE_CLIENT_ID")
	cfg.googleClientSecret = os.Getenv("GOOGLE_CLIENT_SECRET")
	cfg.googleCallbackURL = os.Getenv("GOOGLE_CALLBACK_URL")
	if cfg.googleCallbackURL == "" {
		cfg.googleCallbackURL = fmt.Sprintf("http://localhost:%s/api/account/google/callback", cfg.port)
	}

	cfg.resendAPIKey = os.Getenv("RESEND_API_KEY")
	cfg.resendFrom = envOr("RESEND_FROM", "PetNica <onboarding@resend.dev>")

	return cfg, nil
}
