package app

import (
	"context"
	"crypto/tls"
	_ "embed"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/product-reviews-schema.sql
var productReviewsSchema string

//go:embed migrations/customer-auth-schema.sql
var customerAuthSchema string

//go:embed migrations/delivery-schema.sql
var deliverySchema string

const adminSchema = `
CREATE TABLE IF NOT EXISTS admin_users (
    admin_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email VARCHAR(150) NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`

const adminEmailIndex = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_lower
ON admin_users (lower(email))`

// Misma tabla que crea connect-pg-simple con createTableIfMissing.
const sessionsSchema = `
CREATE TABLE IF NOT EXISTS petnica_sessions (
    "sid"    varchar NOT NULL COLLATE "default",
    "sess"   json NOT NULL,
    "expire" timestamp(6) NOT NULL,
    PRIMARY KEY ("sid")
)`

const sessionsExpireIndex = `
CREATE INDEX IF NOT EXISTS "IDX_petnica_sessions_expire" ON petnica_sessions ("expire")`

func newPool(ctx context.Context, cfg config) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(cfg.databaseURL)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL no es válida: %w", err)
	}
	// node-pg usa ssl solo cuando PGSSL=true; si la URL no indica
	// sslmode, se desactiva para replicar ese comportamiento.
	if cfg.pgssl {
		poolConfig.ConnConfig.TLSConfig = &tls.Config{InsecureSkipVerify: true} // igual que rejectUnauthorized: false
	} else if !strings.Contains(cfg.databaseURL, "sslmode=") {
		poolConfig.ConnConfig.TLSConfig = nil
	}
	// El pooler de Supabase (PgBouncer en modo transacción) invalida los
	// prepared statements entre conexiones; node-pg usa el protocolo simple.
	poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	poolConfig.MaxConnLifetime = 5 * time.Minute
	poolConfig.MaxConnIdleTime = time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, err
	}
	return pool, nil
}

// initialize ejecuta las migraciones idempotentes una vez por instancia,
// igual que el initialize() de server.js. Si falla, el siguiente
// request lo reintenta.
func (a *App) initialize(ctx context.Context) error {
	a.initMu.Lock()
	defer a.initMu.Unlock()
	if a.initDone {
		return nil
	}
	statements := []string{productReviewsSchema, customerAuthSchema, adminSchema, adminEmailIndex, sessionsSchema, sessionsExpireIndex, deliverySchema}
	for _, statement := range statements {
		if _, err := a.pool.Exec(ctx, statement); err != nil {
			return err
		}
	}
	a.initDone = true
	return nil
}

// withTransaction replica el helper withTransaction de los routers Node.
func (a *App) withTransaction(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		if rbErr := tx.Rollback(ctx); rbErr != nil {
			fmt.Printf("No se pudo revertir la transacción: %v\n", rbErr)
		}
		return err
	}
	return tx.Commit(ctx)
}
