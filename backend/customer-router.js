const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const asyncRoute = (handler) => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function text(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw httpError(400, `${label} es obligatorio (máximo ${maxLength} caracteres).`);
  }
  return value.trim();
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw httpError(400, `${label} no puede superar ${maxLength} caracteres.`);
  }
  return value.trim();
}

function positiveId(value, label) {
  if ((typeof value !== 'string' && typeof value !== 'number')
    || !/^[1-9]\d*$/.test(String(value))) {
    throw httpError(400, `${label} no es válido.`);
  }
  const id = BigInt(value);
  if (id > 9223372036854775807n) throw httpError(400, `${label} no es válido.`);
  return id.toString();
}

function sameOrigin(request) {
  const origin = request.get('origin');
  if (!origin) throw httpError(403, 'Solicitud sin origen válido.');
  try {
    if (new URL(origin).host !== request.get('host')) throw httpError(403, 'Origen de solicitud no permitido.');
  } catch (error) {
    if (error.status) throw error;
    throw httpError(403, 'Origen de solicitud no permitido.');
  }
}

function requireCsrf(request, _response, next) {
  try {
    sameOrigin(request);
    const token = request.get('x-csrf-token');
    const expected = request.session?.customerCsrfToken;
    if (typeof token !== 'string' || typeof expected !== 'string') {
      throw httpError(403, 'La sesión expiró. Actualiza la página e inténtalo de nuevo.');
    }
    const supplied = Buffer.from(token);
    const known = Buffer.from(expected);
    if (supplied.length !== known.length || !crypto.timingSafeEqual(supplied, known)) {
      throw httpError(403, 'La sesión expiró. Actualiza la página e inténtalo de nuevo.');
    }
    next();
  } catch (error) {
    next(error);
  }
}

function requireCustomer(request, _response, next) {
  if (!request.session?.customer) return next(httpError(401, 'Inicia sesión para continuar.'));
  next();
}

function validRating(value) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw httpError(400, 'Selecciona una calificación de 1 a 5 estrellas.');
  }
  return rating;
}

function optionalComment(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2000) {
    throw httpError(400, `${label} no puede superar 2000 caracteres.`);
  }
  return value.trim() || null;
}

async function regenerateSession(request) {
  await new Promise((resolve, reject) => {
    request.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

async function saveSession(request) {
  await new Promise((resolve, reject) => {
    request.session.save((error) => error ? reject(error) : resolve());
  });
}

function createCustomerRouter({ pool, authLimiter, googleClient }) {
  const router = express.Router();

  router.get('/google', asyncRoute(async (request, response) => {
    if (!googleClient) throw httpError(503, 'El acceso con Google todavía no está configurado.');
    const state = crypto.randomBytes(32).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');
    request.session.googleOAuth = { state, nonce };
    await saveSession(request);
    response.redirect(googleClient.generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      state,
      nonce,
      prompt: 'select_account',
    }));
  }));

  router.get('/google/callback', asyncRoute(async (request, response) => {
    const oauthState = request.session?.googleOAuth;
    delete request.session.googleOAuth;
    await saveSession(request);
    if (!googleClient || request.query.error || typeof request.query.code !== 'string'
      || typeof request.query.state !== 'string' || !oauthState?.state
      || !safeEqual(request.query.state, oauthState.state)) {
      return response.redirect('/?cuenta=google-error');
    }
    const { tokens } = await googleClient.getToken(request.query.code);
    if (!tokens.id_token) return response.redirect('/?cuenta=google-error');
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const identity = ticket.getPayload();
    if (!identity?.sub || !identity.email || !identity.email_verified
      || !safeEqual(String(identity.nonce || ''), oauthState.nonce)) {
      return response.redirect('/?cuenta=google-error');
    }
    if (identity.email.length > 150) return response.redirect('/?cuenta=google-error');
    const nameParts = String(identity.name || '').trim().split(/\s+/);
    const firstName = (identity.given_name || nameParts.shift() || 'Cliente').slice(0, 80);
    const lastName = (identity.family_name || nameParts.join(' ') || 'Google').slice(0, 80);

    const customer = await withTransaction(pool, async (client) => {
      const existing = await client.query(
        `SELECT customer_id, first_name, last_name, email, phone_whatsapp, password_hash, google_sub
         FROM customers
         WHERE google_sub = $1 OR lower(email) = $2
         ORDER BY (google_sub = $1) DESC
         LIMIT 1 FOR UPDATE`,
        [identity.sub, identity.email.toLowerCase()],
      );
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (row.google_sub && row.google_sub !== identity.sub) {
          throw httpError(409, 'Esta cuenta ya está vinculada con otro acceso de Google.');
        }
        if (row.password_hash?.startsWith('$2') && row.google_sub !== identity.sub) {
          throw httpError(409, 'Ya existe una cuenta con contraseña para este correo. Inicia sesión con correo y contraseña.');
        }
        const updated = await client.query(
          `UPDATE customers SET google_sub = $1
           WHERE customer_id = $2
           RETURNING customer_id, first_name, last_name, email, phone_whatsapp`,
          [identity.sub, row.customer_id],
        );
        return updated.rows[0];
      }

      const referralCode = `PN${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      const inserted = await client.query(
        `INSERT INTO customers
           (first_name, last_name, email, google_sub, referral_code)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING customer_id, first_name, last_name, email, phone_whatsapp`,
        [firstName, lastName, identity.email.toLowerCase(), identity.sub, referralCode],
      );
      return inserted.rows[0];
    });

    await regenerateSession(request);
    request.session.customer = { id: String(customer.customer_id) };
    request.session.customerCsrfToken = crypto.randomBytes(32).toString('hex');
    await saveSession(request);
    response.redirect('/?cuenta=google-success');
  }));

  router.get('/session', asyncRoute(async (request, response) => {
    request.session.customerCsrfToken ||= crypto.randomBytes(32).toString('hex');
    const payload = {
      authenticated: false,
      csrfToken: request.session.customerCsrfToken,
      googleConfigured: Boolean(googleClient),
    };
    if (request.session.customer) {
      const result = await pool.query(
        `SELECT customer_id AS id, first_name AS "firstName", last_name AS "lastName", email,
                phone_whatsapp AS phone
         FROM customers WHERE customer_id = $1`,
        [request.session.customer.id],
      );
      if (!result.rowCount) {
        delete request.session.customer;
        payload.authenticated = false;
      } else {
        Object.assign(payload, { authenticated: true, customer: result.rows[0] });
      }
    }
    response.set('Cache-Control', 'no-store');
    response.json(payload);
  }));

  router.post('/register', authLimiter, requireCsrf, asyncRoute(async (request, response) => {
    const firstName = text(request.body?.firstName, 'El nombre', 80);
    const lastName = text(request.body?.lastName, 'El apellido', 80);
    const email = text(request.body?.email, 'El correo', 150).toLowerCase();
    const phone = optionalText(request.body?.phone, 'El WhatsApp', 20);
    const password = request.body?.password;
    if (!EMAIL_PATTERN.test(email)) throw httpError(400, 'Escribe un correo electrónico válido.');
    if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
      throw httpError(400, 'La contraseña debe tener entre 12 y 200 caracteres.');
    }

    const existing = await pool.query(
      'SELECT password_hash FROM customers WHERE lower(email) = $1',
      [email],
    );
    if (existing.rowCount) {
      throw httpError(409, 'Ya existe una cuenta con ese correo. Inicia sesión o usa Google si corresponde.');
    }
    const hash = await bcrypt.hash(password, 12);
    const referralCode = `PN${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    let customer;
    try {
      const inserted = await pool.query(
        `INSERT INTO customers (first_name, last_name, email, phone_whatsapp, password_hash, referral_code)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING customer_id, first_name, last_name, email, phone_whatsapp`,
        [firstName, lastName, email, phone, hash, referralCode],
      );
      customer = inserted.rows[0];
    } catch (error) {
      if (error.code === '23505') {
        throw httpError(409, 'Ya existe una cuenta con ese correo. Inicia sesión o usa Google si corresponde.');
      }
      throw error;
    }
    await regenerateSession(request);
    request.session.customer = { id: String(customer.customer_id) };
    request.session.customerCsrfToken = crypto.randomBytes(32).toString('hex');
    await saveSession(request);
    response.status(201).json({
      authenticated: true,
      csrfToken: request.session.customerCsrfToken,
      customer: {
        id: String(customer.customer_id),
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phone: customer.phone_whatsapp,
      },
    });
  }));

  router.post('/login', authLimiter, requireCsrf, asyncRoute(async (request, response) => {
    const email = text(request.body?.email, 'El correo', 150).toLowerCase();
    const password = request.body?.password;
    if (!EMAIL_PATTERN.test(email) || typeof password !== 'string' || password.length > 200) {
      throw httpError(400, 'Escribe un correo y una contraseña válidos.');
    }
    const result = await pool.query(
      `SELECT customer_id, first_name, last_name, email, phone_whatsapp, password_hash
       FROM customers WHERE lower(email) = $1`,
      [email],
    );
    const customer = result.rows[0];
    const validPassword = customer?.password_hash
      ? await bcrypt.compare(password, customer.password_hash).catch(() => false)
      : false;
    if (!validPassword) throw httpError(401, 'El correo o la contraseña no son correctos.');
    await regenerateSession(request);
    request.session.customer = { id: String(customer.customer_id) };
    request.session.customerCsrfToken = crypto.randomBytes(32).toString('hex');
    await saveSession(request);
    response.json({
      authenticated: true,
      csrfToken: request.session.customerCsrfToken,
      customer: {
        id: String(customer.customer_id),
        firstName: customer.first_name,
        lastName: customer.last_name,
        email: customer.email,
        phone: customer.phone_whatsapp,
      },
    });
  }));

  router.post('/logout', requireCustomer, requireCsrf, (request, response, next) => {
    delete request.session.customer;
    delete request.session.googleOAuth;
    request.session.customerCsrfToken = crypto.randomBytes(32).toString('hex');
    request.session.save((error) => {
      if (error) return next(error);
      response.json({ authenticated: false, csrfToken: request.session.customerCsrfToken });
    });
  });

  router.get('/cart', requireCustomer, asyncRoute(async (request, response) => {
    const customerId = request.session.customer.id;
    const cartResult = await pool.query(
      'SELECT cart_id FROM carts WHERE customer_id = $1',
      [customerId],
    );
    if (!cartResult.rowCount) return response.json({ items: [], petbox: null });
    const cartId = cartResult.rows[0].cart_id;
    const [items, petbox] = await Promise.all([
      pool.query(
        `SELECT ci.variant_id AS "variantId", ci.quantity, v.stock_qty AS stock
         FROM cart_items ci JOIN product_variants v ON v.variant_id = ci.variant_id
         WHERE ci.cart_id = $1 ORDER BY ci.variant_id`,
        [cartId],
      ),
      pool.query(
        `SELECT plan_id AS "planId", pet_name AS "petName", pet_size AS size
         FROM cart_petbox_items WHERE cart_id = $1`,
        [cartId],
      ),
    ]);
    response.set('Cache-Control', 'no-store');
    response.json({ items: items.rows, petbox: petbox.rows[0] || null });
  }));

  router.put('/cart', requireCustomer, requireCsrf, asyncRoute(async (request, response) => {
    const items = request.body?.items;
    const petbox = request.body?.petbox || null;
    if (!Array.isArray(items) || items.length > 50) throw httpError(400, 'El carrito no es válido.');
    const quantities = new Map();
    for (const item of items) {
      const variantId = String(item.variantId || '');
      const quantity = Number(item.quantity);
      if (!/^\d+$/.test(variantId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        throw httpError(400, 'Hay un producto o cantidad inválida en el carrito.');
      }
      quantities.set(variantId, (quantities.get(variantId) || 0) + quantity);
      if (quantities.get(variantId) > 99) throw httpError(400, 'La cantidad máxima por producto es 99.');
    }

    await withTransaction(pool, async (client) => {
      const cartResult = await client.query(
        `INSERT INTO carts (customer_id) VALUES ($1)
         ON CONFLICT (customer_id) DO UPDATE SET updated_at = now()
         RETURNING cart_id`,
        [request.session.customer.id],
      );
      const cartId = cartResult.rows[0].cart_id;
      for (const [variantId, quantity] of quantities) {
        const result = await client.query(
          `SELECT v.variant_id, v.stock_qty
           FROM product_variants v JOIN products p ON p.product_id = v.product_id
           WHERE v.variant_id = $1 AND v.is_active AND p.is_active FOR SHARE OF v`,
          [variantId],
        );
        if (!result.rowCount || result.rows[0].stock_qty < quantity) {
          throw httpError(409, 'Un producto ya no está disponible o no tiene existencias suficientes.');
        }
      }
      let plan = null;
      if (petbox) {
        if (!/^\d+$/.test(String(petbox.planId || ''))) throw httpError(400, 'El plan PetBox no es válido.');
        const result = await client.query(
          `SELECT plan_id, species, size FROM petbox_plans
           WHERE plan_id = $1 AND is_active FOR SHARE`,
          [petbox.planId],
        );
        plan = result.rows[0];
        if (!plan || (plan.species === 'perro' && petbox.size && plan.size !== petbox.size)) {
          throw httpError(409, 'El plan PetBox ya no está disponible.');
        }
        if (petbox.petName !== null && petbox.petName !== undefined && petbox.petName !== '') {
          text(petbox.petName, 'El nombre de la mascota', 80);
        }
      }
      await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
      for (const [variantId, quantity] of quantities) {
        await client.query(
          'INSERT INTO cart_items (cart_id, variant_id, quantity) VALUES ($1, $2, $3)',
          [cartId, variantId, quantity],
        );
      }
      await client.query('DELETE FROM cart_petbox_items WHERE cart_id = $1', [cartId]);
      if (plan) {
        await client.query(
          `INSERT INTO cart_petbox_items (cart_id, plan_id, pet_name, pet_size)
           VALUES ($1, $2, $3, $4)`,
          [cartId, plan.plan_id, petbox.petName || null, plan.species === 'perro' ? plan.size : null],
        );
      }
    });
    response.json({ saved: true });
  }));

  router.get('/orders', requireCustomer, asyncRoute(async (request, response) => {
    const result = await pool.query(
      `SELECT o.order_id AS id, o.status, o.payment_method AS "paymentMethod",
              o.subtotal_nio AS subtotal, o.discount_nio AS discount,
              o.shipping_nio AS shipping, o.total_nio AS total,
              o.created_at AS "createdAt", o.shipping_address AS "shippingAddress",
              c.first_name AS "firstName", c.last_name AS "lastName",
              c.email, c.phone_whatsapp AS phone,
              COALESCE(pay.status, 'pendiente') AS "paymentStatus",
              (SELECT pl.name FROM petbox_subscriptions s
               JOIN petbox_plans pl ON pl.plan_id = s.plan_id
               WHERE s.subscription_id = o.petbox_subscription_id) AS "petboxName",
              COALESCE(json_agg(json_build_object(
                'name', oi.product_name, 'quantity', oi.quantity,
                'unitPrice', oi.unit_price_nio
              ) ORDER BY oi.order_item_id) FILTER (WHERE oi.order_item_id IS NOT NULL), '[]'::json) AS items
       FROM orders o
       JOIN customers c ON c.customer_id = o.customer_id
       LEFT JOIN order_items oi ON oi.order_id = o.order_id
       LEFT JOIN LATERAL (
         SELECT status FROM payments WHERE order_id = o.order_id
         ORDER BY payment_id DESC LIMIT 1
       ) pay ON TRUE
       WHERE o.customer_id = $1
       GROUP BY o.order_id, c.first_name, c.last_name, c.email, c.phone_whatsapp, pay.status
       ORDER BY o.created_at DESC LIMIT 100`,
      [request.session.customer.id],
    );
    response.set('Cache-Control', 'no-store');
    response.json({ orders: result.rows });
  }));

  router.post('/reviews', requireCustomer, requireCsrf, asyncRoute(async (request, response) => {
    const productId = positiveId(request.body?.productId, 'El producto');
    const orderId = positiveId(request.body?.orderId, 'El pedido');
    const productRating = validRating(request.body?.productRating);
    const productComment = optionalComment(request.body?.productComment, 'El comentario del producto');
    const customerId = request.session.customer.id;

    const result = await withTransaction(pool, async (client) => {
      const orderResult = await client.query(
        `SELECT order_id FROM orders
         WHERE order_id = $1 AND customer_id = $2 AND status = 'entregado'
         FOR UPDATE`,
        [orderId, customerId],
      );
      if (!orderResult.rowCount) {
        throw httpError(403, 'Solo puedes valorar compras entregadas de tu cuenta.');
      }
      const purchasedProduct = await client.query(
        `SELECT 1
         FROM order_items oi
         JOIN product_variants v ON v.variant_id = oi.variant_id
         WHERE oi.order_id = $1 AND v.product_id = $2
         LIMIT 1`,
        [orderId, productId],
      );
      if (!purchasedProduct.rowCount) {
        throw httpError(403, 'Este producto no forma parte del pedido seleccionado.');
      }
      const previousReview = await client.query(
        `SELECT 1 FROM product_reviews
         WHERE customer_id = $1 AND order_id = $2 AND product_id = $3`,
        [customerId, orderId, productId],
      );
      if (previousReview.rowCount) throw httpError(409, 'Ya valoraste este producto en ese pedido.');

      await client.query(
        `INSERT INTO product_reviews (product_id, customer_id, order_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5)`,
        [productId, customerId, orderId, productRating, productComment],
      );

      const existingDeliveryReview = await client.query(
        'SELECT 1 FROM order_delivery_reviews WHERE order_id = $1',
        [orderId],
      );
      let deliveryReviewed = Boolean(existingDeliveryReview.rowCount);
      if (!deliveryReviewed) {
        const deliveryRating = validRating(request.body?.deliveryRating);
        const deliveryComment = optionalComment(request.body?.deliveryComment, 'El comentario de la entrega');
        await client.query(
          `INSERT INTO order_delivery_reviews (order_id, customer_id, rating, comment)
           VALUES ($1, $2, $3, $4)`,
          [orderId, customerId, deliveryRating, deliveryComment],
        );
        deliveryReviewed = true;
      }
      return { deliveryReviewed };
    });

    response.status(201).json({ saved: true, deliveryReviewed: result.deliveryReviewed });
  }));

  return router;
}

function safeEqual(left, right) {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

async function withTransaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => {
      console.error('No se pudo revertir la sincronización del carrito:', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createCustomerRouter,
  httpError,
  positiveId,
  regenerateSession,
  requireCsrf,
  requireCustomer,
  saveSession,
  sameOrigin,
};
