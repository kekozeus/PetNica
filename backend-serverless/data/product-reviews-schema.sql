CREATE TABLE IF NOT EXISTS product_reviews (
    review_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id   BIGINT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    customer_id  BIGINT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    order_id     BIGINT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, order_id, product_id)
);

CREATE TABLE IF NOT EXISTS order_delivery_reviews (
    review_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id     BIGINT NOT NULL UNIQUE REFERENCES orders(order_id) ON DELETE CASCADE,
    customer_id  BIGINT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product_created
    ON product_reviews (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_reviews_created
    ON order_delivery_reviews (created_at DESC);
