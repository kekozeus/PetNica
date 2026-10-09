-- =====================================================================
-- PetNica · Esquema de base de datos para la tienda web
-- Motor: PostgreSQL 14+  (moneda: córdobas, NIO)
-- Autores del proyecto: Blanca Rosales, Samuel Espinoza, Joel Ortiz
--
-- Contenido:
--   1) Tablas       2) Índices       3) Datos de ejemplo
--   4) Pedido de ejemplo (transacción)  5) Consultas para tus KPI
-- Los precios, costos y tarifas de envío son SOLO EJEMPLOS: cámbialos.
-- =====================================================================


-- =====================================================================
-- 1) TABLAS
-- =====================================================================

-- ---------- Clientes y sus mascotas ----------
CREATE TABLE customers (
    customer_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name      VARCHAR(80)  NOT NULL,
    last_name       VARCHAR(80)  NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    phone_whatsapp  VARCHAR(20),                        -- obligatorio antes de coordinar la entrega
    password_hash   TEXT,                                -- contraseña con hash; NULL para cuentas Google
    google_sub      VARCHAR(255) UNIQUE,                 -- identificador único de Google, nunca el correo
    referral_code   VARCHAR(20)  NOT NULL UNIQUE,       -- código propio para recomendar PetNica
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE pets (
    pet_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id     BIGINT       NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    name            VARCHAR(80)  NOT NULL,
    species         VARCHAR(10)  NOT NULL CHECK (species IN ('perro','gato')),
    breed           VARCHAR(80),
    size            VARCHAR(10)  CHECK (size IN ('pequeño','mediano','grande')),
    birth_date      DATE,
    health_notes    TEXT                                -- alergias, dieta especial, etc. (sirve para la PetBox)
);

-- ---------- Entrega a domicilio (Managua) ----------
CREATE TABLE delivery_zones (
    zone_id           SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    district          VARCHAR(60)   NOT NULL UNIQUE,    -- p. ej. 'Distrito I'
    shipping_fee_nio  NUMERIC(10,2) NOT NULL CHECK (shipping_fee_nio >= 0),
    est_days          SMALLINT      NOT NULL DEFAULT 1,
    is_active         BOOLEAN       NOT NULL DEFAULT TRUE
);

CREATE TABLE addresses (
    address_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id         BIGINT       NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    label               VARCHAR(40)  NOT NULL DEFAULT 'Casa',
    zone_id             SMALLINT     NOT NULL REFERENCES delivery_zones(zone_id),
    neighborhood        VARCHAR(100) NOT NULL,          -- barrio / residencial
    landmark_reference  TEXT         NOT NULL,          -- en Nicaragua se usan referencias: "del semáforo, 2 cuadras al lago"
    contact_phone       VARCHAR(20),
    is_default          BOOLEAN      NOT NULL DEFAULT FALSE
);

-- ---------- Catálogo ----------
CREATE TABLE categories (
    category_id  SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         VARCHAR(80) NOT NULL UNIQUE,
    slug         VARCHAR(80) NOT NULL UNIQUE,           -- para URLs: /categoria/alimentos
    parent_id    SMALLINT REFERENCES categories(category_id)
);

CREATE TABLE brands (
    brand_id  SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name      VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE products (
    product_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id     SMALLINT     NOT NULL REFERENCES categories(category_id),
    brand_id        SMALLINT     REFERENCES brands(brand_id),
    name            VARCHAR(150) NOT NULL,
    slug            VARCHAR(160) NOT NULL UNIQUE,
    description     TEXT,
    target_species  VARCHAR(10)  NOT NULL CHECK (target_species IN ('perro','gato','ambos')),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Variantes: una bolsa de 2 kg y una de 8 kg son el mismo producto con distinto precio y stock
CREATE TABLE product_variants (
    variant_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id    BIGINT        NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    sku           VARCHAR(40)   NOT NULL UNIQUE,
    presentation  VARCHAR(60)   NOT NULL,               -- 'Bolsa 2 kg', 'Talla M', etc.
    price_nio     NUMERIC(10,2) NOT NULL CHECK (price_nio >= 0),
    cost_nio      NUMERIC(10,2) CHECK (cost_nio >= 0),  -- para calcular tu margen
    stock_qty     INTEGER       NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
    weight_kg     NUMERIC(6,2),
    is_active     BOOLEAN       NOT NULL DEFAULT TRUE
);

CREATE TABLE product_images (
    image_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id  BIGINT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    url         TEXT   NOT NULL,
    sort_order  SMALLINT NOT NULL DEFAULT 0
);

-- ---------- Carrito (persistente) ----------
CREATE TABLE carts (
    cart_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id  BIGINT NOT NULL UNIQUE REFERENCES customers(customer_id) ON DELETE CASCADE,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cart_items (
    cart_id     BIGINT  NOT NULL REFERENCES carts(cart_id) ON DELETE CASCADE,
    variant_id  BIGINT  NOT NULL REFERENCES product_variants(variant_id),
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (cart_id, variant_id)
);

-- ---------- Promociones y referidos ----------
CREATE TABLE discount_codes (
    code_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code             VARCHAR(30)   NOT NULL UNIQUE,     -- 'PETNICA10'
    discount_type    VARCHAR(10)   NOT NULL CHECK (discount_type IN ('percent','fixed')),
    value            NUMERIC(10,2) NOT NULL CHECK (value > 0),
    min_purchase_nio NUMERIC(10,2) NOT NULL DEFAULT 0,
    max_uses         INTEGER,                           -- NULL = ilimitado
    times_used       INTEGER       NOT NULL DEFAULT 0,
    first_order_only BOOLEAN       NOT NULL DEFAULT FALSE,
    starts_at        TIMESTAMPTZ,
    ends_at          TIMESTAMPTZ,
    is_active        BOOLEAN       NOT NULL DEFAULT TRUE
);

CREATE TABLE referrals (
    referral_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    referrer_id     BIGINT NOT NULL REFERENCES customers(customer_id),
    referred_id     BIGINT NOT NULL UNIQUE REFERENCES customers(customer_id),  -- un cliente solo puede ser referido una vez
    reward_status   VARCHAR(10) NOT NULL DEFAULT 'pendiente' CHECK (reward_status IN ('pendiente','otorgada')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (referrer_id <> referred_id)
);

-- ---------- PetBox mensual ----------
CREATE TABLE petbox_plans (
    plan_id           SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name              VARCHAR(80)   NOT NULL UNIQUE,
    description       TEXT,
    species           VARCHAR(10)   NOT NULL CHECK (species IN ('perro','gato')),
    size              VARCHAR(10)   CHECK (size IN ('pequeño','mediano','grande')),
    monthly_price_nio NUMERIC(10,2) NOT NULL CHECK (monthly_price_nio >= 0),
    is_active         BOOLEAN       NOT NULL DEFAULT TRUE
);

CREATE TABLE cart_petbox_items (
    cart_id    BIGINT PRIMARY KEY REFERENCES carts(cart_id) ON DELETE CASCADE,
    plan_id    SMALLINT NOT NULL REFERENCES petbox_plans(plan_id),
    pet_name   VARCHAR(80),
    pet_size   VARCHAR(10)
);

CREATE TABLE petbox_subscriptions (
    subscription_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id      BIGINT   NOT NULL REFERENCES customers(customer_id),
    pet_id           BIGINT   NOT NULL REFERENCES pets(pet_id),
    plan_id          SMALLINT NOT NULL REFERENCES petbox_plans(plan_id),
    address_id       BIGINT   NOT NULL REFERENCES addresses(address_id),
    status           VARCHAR(10) NOT NULL DEFAULT 'activa' CHECK (status IN ('activa','pausada','cancelada')),
    delivery_day     SMALLINT NOT NULL CHECK (delivery_day BETWEEN 1 AND 28),
    started_on       DATE     NOT NULL DEFAULT CURRENT_DATE,
    next_delivery    DATE     NOT NULL
);

-- ---------- Pedidos y pagos ----------
CREATE TABLE orders (
    order_id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id             BIGINT NOT NULL REFERENCES customers(customer_id),
    address_id              BIGINT REFERENCES addresses(address_id),
    shipping_address        TEXT   NOT NULL,            -- copia de la dirección al momento de comprar (si el cliente la edita, el pedido no cambia)
    petbox_subscription_id  BIGINT REFERENCES petbox_subscriptions(subscription_id),  -- si el pedido viene de una PetBox
    code_id                 BIGINT REFERENCES discount_codes(code_id),
    status                  VARCHAR(12) NOT NULL DEFAULT 'pendiente'
                            CHECK (status IN ('pendiente','confirmado','preparando','en_camino','entregado','cancelado')),
    source_channel          VARCHAR(10) NOT NULL DEFAULT 'web'
                            CHECK (source_channel IN ('instagram','facebook','tiktok','whatsapp','web','referido')),  -- tu KPI de conversiones por canal
    payment_method          VARCHAR(25) NOT NULL
                            CHECK (payment_method IN ('efectivo_contra_entrega','transferencia','tarjeta')),
    subtotal_nio            NUMERIC(10,2) NOT NULL CHECK (subtotal_nio >= 0),
    discount_nio            NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount_nio >= 0),
    shipping_nio            NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (shipping_nio >= 0),
    total_nio               NUMERIC(10,2) NOT NULL,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at            TIMESTAMPTZ,
    CHECK (total_nio = subtotal_nio - discount_nio + shipping_nio)
);

CREATE TABLE order_items (
    order_item_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id        BIGINT        NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    variant_id      BIGINT        NOT NULL REFERENCES product_variants(variant_id),
    product_name    VARCHAR(220)  NOT NULL,             -- copia del nombre al momento de la compra
    unit_price_nio  NUMERIC(10,2) NOT NULL CHECK (unit_price_nio >= 0),  -- copia del precio (el precio del catálogo puede cambiar)
    quantity        INTEGER       NOT NULL CHECK (quantity > 0),
    UNIQUE (order_id, variant_id)
);

CREATE TABLE product_reviews (
    review_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id   BIGINT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    customer_id  BIGINT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    order_id     BIGINT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, order_id, product_id)
);

CREATE TABLE order_delivery_reviews (
    review_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id     BIGINT NOT NULL UNIQUE REFERENCES orders(order_id) ON DELETE CASCADE,
    customer_id  BIGINT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
    payment_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id        BIGINT        NOT NULL REFERENCES orders(order_id),
    method          VARCHAR(25)   NOT NULL,
    status          VARCHAR(10)   NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','verificado','rechazado')),
    amount_nio      NUMERIC(10,2) NOT NULL CHECK (amount_nio >= 0),
    bank_reference  VARCHAR(80),                        -- número de transferencia, si aplica
    paid_at         TIMESTAMPTZ
);


-- =====================================================================
-- 2) ÍNDICES (aceleran las consultas más comunes)
-- =====================================================================
CREATE INDEX idx_pets_customer          ON pets(customer_id);
CREATE INDEX idx_addresses_customer     ON addresses(customer_id);
CREATE INDEX idx_products_category      ON products(category_id);
CREATE INDEX idx_variants_product       ON product_variants(product_id);
CREATE INDEX idx_orders_customer        ON orders(customer_id);
CREATE INDEX idx_orders_created_at      ON orders(created_at);
CREATE INDEX idx_orders_channel         ON orders(source_channel);
CREATE INDEX idx_order_items_variant    ON order_items(variant_id);
CREATE INDEX idx_petbox_next_delivery   ON petbox_subscriptions(next_delivery) WHERE status = 'activa';
CREATE INDEX idx_product_reviews_product_created ON product_reviews(product_id, created_at DESC);
CREATE INDEX idx_delivery_reviews_created ON order_delivery_reviews(created_at DESC);


-- =====================================================================
-- 3) DATOS DE EJEMPLO
-- =====================================================================

-- Zonas de entrega (tarifas de ejemplo)
INSERT INTO delivery_zones (district, shipping_fee_nio, est_days) VALUES
 ('Distrito I',   60, 1), ('Distrito II',  60, 1), ('Distrito III', 60, 1),
 ('Distrito IV',  70, 1), ('Distrito V',   70, 1), ('Distrito VI',  70, 1),
 ('Distrito VII', 70, 1), ('Ciudad Sandino', 90, 2);

-- Categorías (las mismas de tu plan)
INSERT INTO categories (name, slug) VALUES
 ('Alimentos', 'alimentos'),
 ('Premios y snacks', 'premios-snacks'),
 ('Juguetes', 'juguetes'),
 ('Camas y accesorios', 'camas-accesorios'),
 ('Collares y personalizados', 'collares-personalizados'),
 ('Higiene', 'higiene');

-- Productos de ejemplo
INSERT INTO products (category_id, name, slug, description, target_species)
SELECT c.category_id, v.name, v.slug, v.descr, v.species
FROM (VALUES
  ('alimentos', 'Alimento seco adulto para perro', 'alimento-seco-adulto-perro', 'Alimento balanceado para perros adultos.', 'perro'),
  ('juguetes',  'Pelota de goma resistente',       'pelota-goma-resistente',     'Juguete duradero para morder y jugar.',    'perro'),
  ('higiene',   'Arena sanitaria para gatos',      'arena-sanitaria-gatos',      'Arena aglomerante de bajo polvo.',         'gato')
) AS v(cat_slug, name, slug, descr, species)
JOIN categories c ON c.slug = v.cat_slug;

-- Variantes (precio, costo, stock)
INSERT INTO product_variants (product_id, sku, presentation, price_nio, cost_nio, stock_qty, weight_kg)
SELECT p.product_id, v.sku, v.presentation, v.price, v.cost, v.stock, v.weight
FROM (VALUES
  ('alimento-seco-adulto-perro', 'AL-PER-ADU-2KG', 'Bolsa 2 kg',  520.00,  400.00, 30, 2.00),
  ('alimento-seco-adulto-perro', 'AL-PER-ADU-8KG', 'Bolsa 8 kg', 1650.00, 1300.00, 15, 8.00),
  ('pelota-goma-resistente',     'JU-PEL-GOMA-M',  'Talla M',     180.00,  100.00, 40, 0.20),
  ('arena-sanitaria-gatos',      'HI-ARE-GAT-5KG', 'Bolsa 5 kg',  380.00,  290.00, 25, 5.00)
) AS v(slug, sku, presentation, price, cost, stock, weight)
JOIN products p ON p.slug = v.slug;

-- Código de lanzamiento de tu plan: 10% en la primera compra
INSERT INTO discount_codes (code, discount_type, value, first_order_only)
VALUES ('PETNICA10', 'percent', 10, TRUE);

-- Planes PetBox (precios de ejemplo)
INSERT INTO petbox_plans (name, species, size, monthly_price_nio, description) VALUES
 ('PetBox Perro Pequeño', 'perro', 'pequeño', 600, 'Snacks, juguete y artículo de higiene para perros pequeños.'),
 ('PetBox Perro Mediano', 'perro', 'mediano', 700, 'Snacks, juguete y artículo de higiene para perros medianos.'),
 ('PetBox Perro Grande',  'perro', 'grande',  850, 'Snacks, juguete y artículo de higiene para perros grandes.'),
 ('PetBox Gato',          'gato',  NULL,      550, 'Snacks, juguete y artículo de higiene para gatos.');

-- Cliente de ejemplo (la "María" de tu buyer persona), su dirección, su mascota y su PetBox
INSERT INTO customers (first_name, last_name, email, phone_whatsapp, password_hash, referral_code)
VALUES ('María', 'López', 'maria@example.com', '+505 8888-0000', 'hash_de_ejemplo', 'MARIA28');

INSERT INTO addresses (customer_id, label, zone_id, neighborhood, landmark_reference, is_default)
SELECT c.customer_id, 'Casa', z.zone_id, 'Barrio de ejemplo', 'Del semáforo principal, 2 cuadras al lago', TRUE
FROM customers c, delivery_zones z
WHERE c.email = 'maria@example.com' AND z.district = 'Distrito III';

INSERT INTO pets (customer_id, name, species, breed, size)
SELECT customer_id, 'Luna', 'perro', 'Criollo', 'mediano' FROM customers WHERE email = 'maria@example.com';

INSERT INTO petbox_subscriptions (customer_id, pet_id, plan_id, address_id, delivery_day, next_delivery)
SELECT c.customer_id, pt.pet_id, pl.plan_id, a.address_id, 15, CURRENT_DATE + 5
FROM customers c
JOIN pets pt       ON pt.customer_id = c.customer_id
JOIN addresses a   ON a.customer_id = c.customer_id AND a.is_default
JOIN petbox_plans pl ON pl.name = 'PetBox Perro Mediano'
WHERE c.email = 'maria@example.com';


-- =====================================================================
-- 4) PEDIDO DE EJEMPLO (transacción)
--    María compra 2 bolsas de 2 kg con PETNICA10, llegó desde Instagram.
--    Subtotal 1040.00 - 10% (104.00) + envío = total
-- =====================================================================
BEGIN;

-- 4.1) Descontar stock. Si afecta 0 filas, no había inventario: haz ROLLBACK.
UPDATE product_variants
SET    stock_qty = stock_qty - 2
WHERE  sku = 'AL-PER-ADU-2KG' AND stock_qty >= 2;

-- 4.2) Crear el pedido y sus líneas en un solo paso
WITH new_order AS (
    INSERT INTO orders (customer_id, address_id, shipping_address, code_id, status, source_channel,
                        payment_method, subtotal_nio, discount_nio, shipping_nio, total_nio)
    SELECT c.customer_id, a.address_id,
           a.neighborhood || ' - ' || a.landmark_reference,
           d.code_id, 'pendiente', 'instagram', 'transferencia',
           1040.00, 104.00, z.shipping_fee_nio,
           1040.00 - 104.00 + z.shipping_fee_nio
    FROM customers c
    JOIN addresses a       ON a.customer_id = c.customer_id AND a.is_default
    JOIN delivery_zones z  ON z.zone_id = a.zone_id
    CROSS JOIN discount_codes d
    WHERE c.email = 'maria@example.com' AND d.code = 'PETNICA10'
    RETURNING order_id
)
INSERT INTO order_items (order_id, variant_id, product_name, unit_price_nio, quantity)
SELECT n.order_id, v.variant_id, 'Alimento seco adulto para perro - ' || v.presentation, v.price_nio, 2
FROM new_order n
JOIN product_variants v ON v.sku = 'AL-PER-ADU-2KG';

-- 4.3) Registrar el uso del código
UPDATE discount_codes SET times_used = times_used + 1 WHERE code = 'PETNICA10';

COMMIT;


-- =====================================================================
-- 5) CONSULTAS PARA TUS KPI Y PARA OPERAR LA TIENDA
-- =====================================================================

-- 5.1) Conversiones y ventas por canal (Instagram, TikTok, WhatsApp...)
SELECT source_channel, COUNT(*) AS pedidos, SUM(total_nio) AS ventas_nio
FROM   orders
WHERE  status <> 'cancelado'
GROUP  BY source_channel
ORDER  BY pedidos DESC;

-- 5.2) Productos más vendidos
SELECT oi.product_name, SUM(oi.quantity) AS unidades, SUM(oi.quantity * oi.unit_price_nio) AS ventas_nio
FROM   order_items oi
JOIN   orders o ON o.order_id = oi.order_id
WHERE  o.status <> 'cancelado'
GROUP  BY oi.product_name
ORDER  BY unidades DESC
LIMIT  10;

-- 5.3) Ventas por mes
SELECT date_trunc('month', created_at)::date AS mes, COUNT(*) AS pedidos, SUM(total_nio) AS ventas_nio
FROM   orders
WHERE  status <> 'cancelado'
GROUP  BY 1
ORDER  BY 1;

-- 5.4) Uso del código PETNICA10 y descuento total entregado
SELECT d.code, COUNT(o.order_id) AS veces_usado, COALESCE(SUM(o.discount_nio), 0) AS descuento_total_nio
FROM   discount_codes d
LEFT   JOIN orders o ON o.code_id = d.code_id AND o.status <> 'cancelado'
GROUP  BY d.code;

-- 5.5) Porcentaje de clientes que repiten compra (fidelización)
SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE n >= 2) / NULLIF(COUNT(*), 0), 1) AS clientes_recurrentes_pct
FROM  (SELECT customer_id, COUNT(*) AS n
       FROM   orders
       WHERE  status <> 'cancelado'
       GROUP  BY customer_id) t;

-- 5.6) Productos con poco stock (reponer)
SELECT p.name, v.sku, v.presentation, v.stock_qty
FROM   product_variants v
JOIN   products p ON p.product_id = v.product_id
WHERE  v.is_active AND v.stock_qty <= 5
ORDER  BY v.stock_qty;

-- 5.7) Margen por variante
SELECT p.name, v.presentation, v.price_nio, v.cost_nio,
       ROUND(100.0 * (v.price_nio - v.cost_nio) / v.price_nio, 1) AS margen_pct
FROM   product_variants v
JOIN   products p ON p.product_id = v.product_id
WHERE  v.cost_nio IS NOT NULL
ORDER  BY margen_pct DESC;

-- 5.8) PetBox que hay que preparar en los próximos 7 días
SELECT s.subscription_id, c.first_name, pt.name AS mascota, pl.name AS plan, s.next_delivery
FROM   petbox_subscriptions s
JOIN   customers c    ON c.customer_id = s.customer_id
JOIN   pets pt        ON pt.pet_id = s.pet_id
JOIN   petbox_plans pl ON pl.plan_id = s.plan_id
WHERE  s.status = 'activa' AND s.next_delivery <= CURRENT_DATE + 7
ORDER  BY s.next_delivery;
