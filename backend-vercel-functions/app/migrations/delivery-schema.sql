-- Repartidores, pruebas de entrega y aceptación de condiciones.
ALTER TABLE admin_users
    ADD COLUMN IF NOT EXISTS role VARCHAR(12) NOT NULL DEFAULT 'admin';

ALTER TABLE admin_users
    DROP CONSTRAINT IF EXISTS admin_users_role_check;

ALTER TABLE admin_users
    ADD CONSTRAINT admin_users_role_check CHECK (role IN ('admin','repartidor'));

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- Prueba de entrega registrada por el repartidor: video + firma del receptor.
CREATE TABLE IF NOT EXISTS order_deliveries (
    order_id        BIGINT PRIMARY KEY REFERENCES orders(order_id) ON DELETE CASCADE,
    courier_id      BIGINT NOT NULL REFERENCES admin_users(admin_id),
    status          VARCHAR(12) NOT NULL DEFAULT 'en_camino' CHECK (status IN ('en_camino','entregado')),
    recipient_name  VARCHAR(160),
    signature_data  TEXT,
    video_url       TEXT,
    video_path      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_order_deliveries_courier
    ON order_deliveries (courier_id);
