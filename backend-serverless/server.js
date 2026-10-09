const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { rateLimit } = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const { Pool } = require('pg');
const { createAdminRouter } = require('./admin-router');
const { createCustomerRouter } = require('./customer-router');

const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
});
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
const PgSession = connectPgSimple(session);

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('Configura SESSION_SECRET con un valor aleatorio antes de iniciar en producción.');
}
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET no configurado: las sesiones de administrador se invalidarán al reiniciar.');
}

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(session({
  name: 'petnica.sid',
  store: new PgSession({
    pool,
    tableName: 'petnica_sessions',
    createTableIfMissing: true,
    pruneSessionInterval: 15 * 60,
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));
if (!process.env.VERCEL) app.use(express.static(path.join(__dirname, 'public')));

pool.on('error', (error) => {
  console.error('Error inesperado en el pool de PostgreSQL:', error);
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos y vuelve a intentarlo.' },
});
const customerAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos y vuelve a intentarlo.' },
});
const googleClient = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  ? new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL || `http://localhost:${port}/api/account/google/callback`,
  )
  : null;

app.get('/admin', (_request, response) => {
  response.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use('/api/admin', createAdminRouter({
  pool,
  imageDirectory: path.join(__dirname, 'public', 'images'),
  loginLimiter,
}));
app.use('/api/account', createCustomerRouter({
  pool,
  authLimiter: customerAuthLimiter,
  googleClient,
}));

function requiredText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    const error = new Error(`${label} es obligatorio y debe tener máximo ${maxLength} caracteres.`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    const error = new Error(`${label} no puede superar ${maxLength} caracteres.`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

app.get('/api/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('No se pudo comprobar la conexión con PostgreSQL:', error);
    response.status(503).json({ error: 'No se pudo conectar con PostgreSQL.' });
  }
});

app.get('/api/catalog', async (_request, response, next) => {
  try {
    const [categories, products, plans, zones] = await Promise.all([
      pool.query('SELECT category_id AS id, name, slug FROM categories ORDER BY category_id'),
      pool.query(`
        SELECT p.product_id AS id, p.name, p.slug, p.description,
               p.target_species AS species, c.name AS category,
               COALESCE(
                 (SELECT pi.url FROM product_images pi
                  WHERE pi.product_id = p.product_id
                  ORDER BY pi.sort_order, pi.image_id LIMIT 1),
                 '/images/' || p.slug || '.jpg'
               ) AS image,
               COALESCE(review_summary.rating, 0) AS rating,
               COALESCE(review_summary.review_count, 0) AS "reviewCount",
               json_agg(json_build_object(
                 'id', v.variant_id, 'presentation', v.presentation,
                 'price', v.price_nio, 'stock', v.stock_qty
               ) ORDER BY v.price_nio, v.variant_id) AS variants
        FROM products p
        JOIN categories c ON c.category_id = p.category_id
        JOIN product_variants v ON v.product_id = p.product_id
        LEFT JOIN (
          SELECT product_id, avg(rating)::numeric(3,2) AS rating, count(*)::integer AS review_count
          FROM product_reviews
          GROUP BY product_id
        ) review_summary ON review_summary.product_id = p.product_id
        WHERE p.is_active AND v.is_active
        GROUP BY p.product_id, c.name, review_summary.rating, review_summary.review_count
        ORDER BY p.name
      `),
      pool.query(`
        SELECT plan_id AS id, name, description, species, size, monthly_price_nio AS price
        FROM petbox_plans WHERE is_active ORDER BY plan_id
      `),
      pool.query(`
        SELECT zone_id AS id, district, shipping_fee_nio AS fee, est_days AS days
        FROM delivery_zones WHERE is_active ORDER BY zone_id
      `),
    ]);

    response.json({
      categories: categories.rows,
      products: products.rows,
      plans: plans.rows,
      zones: zones.rows,
      whatsapp: process.env.WHATSAPP_NUMBER || '',
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/products/:productId', async (request, response, next) => {
  try {
    const rawProductId = request.params.productId;
    const productId = /^[1-9]\d{0,18}$/.test(rawProductId)
      && BigInt(rawProductId) <= 9223372036854775807n
      ? rawProductId
      : null;
    if (!productId) return response.status(400).json({ error: 'El producto solicitado no es válido.' });

    const [productResult, reviewsResult, deliveryResult, deliveryReviewsResult] = await Promise.all([
      pool.query(
        `SELECT p.product_id AS id, p.name, p.slug, p.description,
                p.target_species AS species, c.name AS category,
                COALESCE(
                  (SELECT pi.url FROM product_images pi
                   WHERE pi.product_id = p.product_id
                   ORDER BY pi.sort_order, pi.image_id LIMIT 1),
                  '/images/' || p.slug || '.jpg'
                ) AS image,
                COALESCE(summary.rating, 0) AS rating,
                COALESCE(summary.review_count, 0) AS "reviewCount",
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'id', v.variant_id, 'presentation', v.presentation,
                    'price', v.price_nio, 'stock', v.stock_qty
                  ) ORDER BY v.price_nio, v.variant_id)
                  FROM product_variants v
                  WHERE v.product_id = p.product_id AND v.is_active
                ), '[]'::json) AS variants
         FROM products p
         JOIN categories c ON c.category_id = p.category_id
         LEFT JOIN (
           SELECT product_id, avg(rating)::numeric(3,2) AS rating, count(*)::integer AS review_count
           FROM product_reviews
           GROUP BY product_id
         ) summary ON summary.product_id = p.product_id
         WHERE p.product_id = $1 AND p.is_active`,
        [productId],
      ),
      pool.query(
        `SELECT r.rating, r.comment, r.created_at AS "createdAt",
                c.first_name || ' ' || left(c.last_name, 1) || '.' AS "customerName"
         FROM product_reviews r
         JOIN customers c ON c.customer_id = r.customer_id
         WHERE r.product_id = $1
         ORDER BY r.created_at DESC, r.review_id DESC
         LIMIT 40`,
        [productId],
      ),
      pool.query(
        `SELECT avg(rating)::numeric(3,2) AS rating, count(*)::integer AS "reviewCount"
         FROM order_delivery_reviews`,
      ),
      pool.query(
        `SELECT r.rating, r.comment, r.created_at AS "createdAt",
                c.first_name || ' ' || left(c.last_name, 1) || '.' AS "customerName"
         FROM order_delivery_reviews r
         JOIN customers c ON c.customer_id = r.customer_id
         ORDER BY r.created_at DESC, r.review_id DESC
         LIMIT 20`,
      ),
    ]);
    if (!productResult.rowCount) return response.status(404).json({ error: 'No encontramos ese producto.' });

    let eligibleOrders = null;
    if (request.session?.customer?.id) {
      const eligibility = await pool.query(
        `SELECT DISTINCT o.order_id AS id, o.created_at AS "createdAt",
                EXISTS (
                  SELECT 1 FROM order_delivery_reviews dr WHERE dr.order_id = o.order_id
                ) AS "deliveryReviewed"
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.order_id
         JOIN product_variants v ON v.variant_id = oi.variant_id
         WHERE o.customer_id = $1 AND o.status = 'entregado'
           AND v.product_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM product_reviews r
             WHERE r.customer_id = $1 AND r.order_id = o.order_id AND r.product_id = $2
           )
         ORDER BY o.created_at DESC
         LIMIT 50`,
        [request.session.customer.id, productId],
      );
      eligibleOrders = eligibility.rows;
    }

    response.set('Cache-Control', 'no-store');
    response.json({
      product: productResult.rows[0],
      reviews: reviewsResult.rows,
      deliveryRating: deliveryResult.rows[0]?.rating || 0,
      deliveryReviewCount: deliveryResult.rows[0]?.reviewCount || 0,
      deliveryReviews: deliveryReviewsResult.rows,
      eligibleOrders,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders', async (request, response, next) => {
  if (!request.session?.customer?.id) {
    const error = new Error('Inicia sesión para confirmar tu pedido.');
    error.status = 401;
    return next(error);
  }

  const client = await pool.connect().catch(next);
  if (!client) return;

  try {
    const phone = optionalText(request.body.phone, 'El WhatsApp', 20);
    const neighborhood = requiredText(request.body.neighborhood, 'El barrio o residencial', 100);
    const reference = requiredText(request.body.reference, 'La referencia', 2000);
    const zoneId = Number(request.body.zoneId);
    const paymentMethod = request.body.paymentMethod;
    const items = request.body.items;
    const petbox = request.body.petbox || null;
    const promoCode = request.body.promoCode
      ? requiredText(request.body.promoCode, 'El código promocional', 30).toUpperCase()
      : null;

    if (!Number.isInteger(zoneId) || !Array.isArray(items) || items.length > 50) {
      const error = new Error('Revisa la zona de entrega y los productos del carrito.');
      error.status = 400;
      throw error;
    }
    if (!['efectivo_contra_entrega', 'transferencia'].includes(paymentMethod)) {
      const error = new Error('Selecciona un método de pago válido.');
      error.status = 400;
      throw error;
    }
    if (!items.length && !petbox) {
      const error = new Error('Agrega al menos un producto o una PetBox.');
      error.status = 400;
      throw error;
    }

    const quantities = new Map();
    for (const item of items) {
      const variantId = String(item.variantId || '');
      const quantity = Number(item.quantity);
      if (!/^\d+$/.test(variantId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        const error = new Error('Hay un producto o una cantidad inválida en el carrito.');
        error.status = 400;
        throw error;
      }
      quantities.set(variantId, (quantities.get(variantId) || 0) + quantity);
      if (quantities.get(variantId) > 99) {
        const error = new Error('La cantidad máxima por producto es 99 unidades.');
        error.status = 400;
        throw error;
      }
    }

    await client.query('BEGIN');

    const zoneResult = await client.query(
      'SELECT zone_id, district, shipping_fee_nio FROM delivery_zones WHERE zone_id = $1 AND is_active FOR SHARE',
      [zoneId],
    );
    if (!zoneResult.rowCount) {
      const error = new Error('La zona de entrega seleccionada no está disponible.');
      error.status = 400;
      throw error;
    }
    const zone = zoneResult.rows[0];

    const customerId = String(request.session.customer.id);
    const ownCustomer = await client.query(
      `UPDATE customers SET phone_whatsapp = $1
       WHERE customer_id = $2
       RETURNING customer_id`,
      [phone, customerId],
    );
    if (!ownCustomer.rowCount) {
      const error = new Error('No se encontró la cuenta conectada. Inicia sesión de nuevo.');
      error.status = 401;
      throw error;
    }
    const addressResult = await client.query(
      `INSERT INTO addresses (customer_id, label, zone_id, neighborhood, landmark_reference, contact_phone)
       VALUES ($1, 'Entrega web', $2, $3, $4, $5)
       RETURNING address_id`,
      [customerId, zone.zone_id, neighborhood, reference, phone],
    );
    const addressId = addressResult.rows[0].address_id;
    const shippingAddress = `${zone.district} · ${neighborhood} · ${reference}`;

    let subtotalCents = 0;
    const orderLines = [];
    for (const [variantId, quantity] of quantities) {
      const variantResult = await client.query(
        `SELECT v.variant_id, v.product_id, v.presentation, v.price_nio, v.stock_qty, p.name
         FROM product_variants v
         JOIN products p ON p.product_id = v.product_id
         WHERE v.variant_id = $1 AND v.is_active AND p.is_active
         FOR UPDATE OF v`,
        [variantId],
      );
      const variant = variantResult.rows[0];
      if (!variant || variant.stock_qty < quantity) {
        const error = new Error(
          variant ? `No hay suficiente inventario de ${variant.name} (${variant.presentation}).` : 'Uno de los productos ya no está disponible.',
        );
        error.status = 409;
        throw error;
      }
      subtotalCents += Math.round(Number(variant.price_nio) * 100) * quantity;
      orderLines.push({ ...variant, quantity });
    }

    let subscriptionId = null;
    let petboxLine = null;
    if (petbox) {
      const planId = String(petbox.planId || '');
      if (!/^\d+$/.test(planId)) {
        const error = new Error('Selecciona un plan PetBox válido.');
        error.status = 400;
        throw error;
      }
      const planResult = await client.query(
        `SELECT plan_id, name, species, size, monthly_price_nio
         FROM petbox_plans WHERE plan_id = $1 AND is_active FOR SHARE`,
        [planId],
      );
      const plan = planResult.rows[0];
      if (!plan) {
        const error = new Error('El plan PetBox seleccionado ya no está disponible.');
        error.status = 409;
        throw error;
      }
      const petName = requiredText(petbox.petName, 'El nombre de tu mascota', 80);
      const size = petbox.size || null;
      if (plan.species !== 'gato' && !['pequeño', 'mediano', 'grande'].includes(size)) {
        const error = new Error('Selecciona el tamaño de tu perro para su PetBox.');
        error.status = 400;
        throw error;
      }
      if (plan.species === 'perro' && plan.size !== size) {
        const error = new Error('El tamaño de tu mascota no coincide con el plan PetBox seleccionado.');
        error.status = 400;
        throw error;
      }
      const petSize = plan.species === 'gato' ? null : size;
      let petResult = await client.query(
        `SELECT pet_id FROM pets
         WHERE customer_id = $1 AND name = $2 AND species = $3
           AND size IS NOT DISTINCT FROM $4::varchar
         ORDER BY pet_id LIMIT 1`,
        [customerId, petName, plan.species, petSize],
      );
      if (!petResult.rowCount) {
        petResult = await client.query(
          'INSERT INTO pets (customer_id, name, species, size) VALUES ($1, $2, $3, $4) RETURNING pet_id',
          [customerId, petName, plan.species, petSize],
        );
      }
      const subscriptionResult = await client.query(
        `INSERT INTO petbox_subscriptions
           (customer_id, pet_id, plan_id, address_id, delivery_day, next_delivery)
         VALUES ($1, $2, $3, $4, 15, CURRENT_DATE + INTERVAL '1 month')
         RETURNING subscription_id`,
        [customerId, petResult.rows[0].pet_id, plan.plan_id, addressId],
      );
      subscriptionId = subscriptionResult.rows[0].subscription_id;
      petboxLine = { name: plan.name, price: Number(plan.monthly_price_nio) };
      subtotalCents += Math.round(petboxLine.price * 100);
    }

    let codeId = null;
    let discountCents = 0;
    if (promoCode) {
      const codeResult = await client.query(
        `SELECT code_id, discount_type, value, min_purchase_nio, max_uses, times_used,
                first_order_only, starts_at, ends_at
         FROM discount_codes
         WHERE code = $1 AND is_active
           AND (starts_at IS NULL OR starts_at <= now())
           AND (ends_at IS NULL OR ends_at >= now())
           AND (max_uses IS NULL OR times_used < max_uses)
         FOR UPDATE`,
        [promoCode],
      );
      const code = codeResult.rows[0];
      const priorOrders = code?.first_order_only
        ? await client.query(
          `SELECT 1 FROM orders WHERE customer_id = $1 AND status <> 'cancelado' LIMIT 1`,
          [customerId],
        )
        : null;
      if (!code || subtotalCents < Math.round(Number(code.min_purchase_nio) * 100)
        || (priorOrders && priorOrders.rowCount)) {
        const error = new Error('El código no es válido para este pedido.');
        error.status = 400;
        throw error;
      }
      codeId = code.code_id;
      discountCents = code.discount_type === 'percent'
        ? Math.min(subtotalCents, Math.round(subtotalCents * Number(code.value) / 100))
        : Math.min(Math.round(Number(code.value) * 100), subtotalCents);
    }

    const subtotal = subtotalCents / 100;
    const discount = discountCents / 100;
    const shippingCents = Math.round(Number(zone.shipping_fee_nio) * 100);
    const shipping = shippingCents / 100;
    const total = (subtotalCents - discountCents + shippingCents) / 100;
    const orderResult = await client.query(
      `INSERT INTO orders
         (customer_id, address_id, shipping_address, petbox_subscription_id, code_id,
          status, source_channel, payment_method, subtotal_nio, discount_nio, shipping_nio, total_nio)
       VALUES ($1, $2, $3, $4, $5, 'pendiente', 'web', $6, $7, $8, $9, $10)
       RETURNING order_id`,
      [customerId, addressId, shippingAddress, subscriptionId, codeId,
        paymentMethod, subtotal, discount, shipping, total],
    );
    const orderId = orderResult.rows[0].order_id;

    for (const line of orderLines) {
      await client.query(
        `INSERT INTO order_items (order_id, variant_id, product_name, unit_price_nio, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, line.variant_id, `${line.name} - ${line.presentation}`, line.price_nio, line.quantity],
      );
      await client.query(
        'UPDATE product_variants SET stock_qty = stock_qty - $1 WHERE variant_id = $2',
        [line.quantity, line.variant_id],
      );
    }
    if (paymentMethod === 'transferencia') {
      await client.query(
        `INSERT INTO payments (order_id, method, status, amount_nio)
         VALUES ($1, $2, 'pendiente', $3)`,
        [orderId, paymentMethod, total],
      );
    }
    if (codeId) {
      await client.query('UPDATE discount_codes SET times_used = times_used + 1 WHERE code_id = $1', [codeId]);
    }
    if (request.session?.customer) {
      const cartResult = await client.query(
        'SELECT cart_id FROM carts WHERE customer_id = $1',
        [customerId],
      );
      if (cartResult.rowCount) {
        await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartResult.rows[0].cart_id]);
        await client.query('DELETE FROM cart_petbox_items WHERE cart_id = $1', [cartResult.rows[0].cart_id]);
      }
    }

    await client.query('COMMIT');
    response.status(201).json({
      orderId,
      subtotal: subtotal.toFixed(2),
      discount: discount.toFixed(2),
      shipping: shipping.toFixed(2),
      total: total.toFixed(2),
      shippingAddress,
      whatsapp: process.env.WHATSAPP_NUMBER || '',
      items: [
        ...orderLines.map((line) => ({
          name: `${line.name} - ${line.presentation}`,
          quantity: line.quantity,
          price: (Number(line.price_nio) * line.quantity).toFixed(2),
        })),
        ...(petboxLine ? [{ name: petboxLine.name, quantity: 1, price: petboxLine.price.toFixed(2) }] : []),
      ],
    });
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => {
      console.error('No se pudo revertir la transacción del pedido:', rollbackError);
    });
    next(error);
  } finally {
    client.release();
  }
});

app.use((error, _request, response, _next) => {
  if (error.status || error.code === 'LIMIT_FILE_SIZE' || error.type === 'entity.parse.failed') {
    const status = error.status || (error.code === 'LIMIT_FILE_SIZE' || error.type === 'entity.parse.failed' ? 400 : 500);
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'La imagen supera el límite de 5 MB.'
      : error.type === 'entity.parse.failed'
        ? 'El cuerpo de la solicitud no contiene JSON válido.'
        : error.message;
    return response.status(status).json({ error: message });
  }
  if (error.code === '23505') {
    return response.status(409).json({ error: 'Ya existe un producto, SKU o administrador con esos datos.' });
  }
  if (error.code === '23503' || error.code === '23514') {
    return response.status(400).json({ error: 'Uno de los datos seleccionados no es válido.' });
  }
  console.error('Error al procesar la solicitud:', error);
  return response.status(500).json({ error: 'Ocurrió un error al procesar la solicitud.' });
});

let initialization;

function initialize() {
  if (!initialization) {
    initialization = (async () => {
      const reviewSchema = await require('node:fs/promises').readFile(
        path.join(__dirname, 'data', 'product-reviews-schema.sql'),
        'utf8',
      );
      await pool.query(reviewSchema);
      const customerSchema = await require('node:fs/promises').readFile(
        path.join(__dirname, 'data', 'customer-auth-schema.sql'),
        'utf8',
      );
      await pool.query(customerSchema);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_users (
          admin_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          email VARCHAR(150) NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email_lower
        ON admin_users (lower(email))
      `);
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

async function start() {
  await initialize();
  app.listen(port, () => {
    console.log(`PetNica disponible en http://localhost:${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('No se pudo preparar la base de datos de PetNica:', error);
    pool.end().finally(() => process.exit(1));
  });

  process.on('SIGINT', () => {
    pool.end().finally(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    pool.end().finally(() => process.exit(0));
  });
}

module.exports = { app, initialize, pool };
