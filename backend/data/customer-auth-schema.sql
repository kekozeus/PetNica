ALTER TABLE customers
    ALTER COLUMN phone_whatsapp DROP NOT NULL,
    ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_google_sub
    ON customers (google_sub)
    WHERE google_sub IS NOT NULL;

CREATE TABLE IF NOT EXISTS cart_petbox_items (
    cart_id    BIGINT PRIMARY KEY REFERENCES carts(cart_id) ON DELETE CASCADE,
    plan_id    SMALLINT NOT NULL REFERENCES petbox_plans(plan_id),
    pet_name   VARCHAR(80),
    pet_size   VARCHAR(10)
);
