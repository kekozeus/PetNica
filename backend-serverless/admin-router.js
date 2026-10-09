const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const ORDER_STATUSES = ['pendiente', 'confirmado', 'preparando', 'en_camino', 'entregado', 'cancelado'];
const PAYMENT_STATUSES = ['pendiente', 'verificado', 'rechazado'];
const SPECIES = ['perro', 'gato', 'ambos'];
const SIZES = ['pequeño', 'mediano', 'grande'];
const slugify = (value) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const asyncRoute = (handler) => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function text(value, label, maxLength, optional = false) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw httpError(400, `${label} es obligatorio y debe tener máximo ${maxLength} caracteres.`);
  }
  return value.trim();
}

function positiveId(value, label = 'Identificador') {
  if (!/^\d+$/.test(String(value || '')) || Number(value) < 1) {
    throw httpError(400, `${label} no es válido.`);
  }
  return String(value);
}

function nonNegativeNumber(value, label, { integer = false, max = 99999999 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max || (integer && !Number.isInteger(number))) {
    throw httpError(400, `${label} debe ser un número válido.`);
  }
  return number;
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

function requireAdmin(request, _response, next) {
  if (!request.session?.admin) return next(httpError(401, 'Inicia sesión para continuar.'));
  next();
}

function requireCsrf(request, _response, next) {
  try {
    sameOrigin(request);
    const token = request.get('x-csrf-token');
    const expected = request.session?.csrfToken;
    if (typeof token !== 'string' || typeof expected !== 'string') {
      throw httpError(403, 'La sesión expiró. Inicia sesión de nuevo.');
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

function imageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', mime: 'image/jpeg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { extension: 'png', mime: 'image/png' };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { extension: 'webp', mime: 'image/webp' };
  }
  return null;
}

function makeImageUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_request, file, callback) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
        callback(httpError(400, 'Usa una imagen JPG, PNG o WebP de hasta 5 MB.'));
        return;
      }
      callback(null, true);
    },
  }).single('image');
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
      console.error('No se pudo revertir la transacción administrativa:', rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

function createAdminRouter({ pool, imageDirectory, loginLimiter }) {
  const router = express.Router();
  const uploadImage = makeImageUpload();

  router.get('/session', (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json(request.session?.admin
      ? { authenticated: true, email: request.session.admin.email, csrfToken: request.session.csrfToken }
      : { authenticated: false });
  });

  router.post('/login', loginLimiter, asyncRoute(async (request, response) => {
    sameOrigin(request);
    const email = text(request.body?.email, 'El correo', 150).toLowerCase();
    const password = request.body?.password;
    if (typeof password !== 'string' || password.length < 1 || password.length > 200) {
      throw httpError(400, 'Escribe tu correo y contraseña.');
    }
    const result = await pool.query(
      'SELECT admin_id, email, password_hash FROM admin_users WHERE lower(email) = $1',
      [email],
    );
    const admin = result.rows[0];
    const matches = admin ? await bcrypt.compare(password, admin.password_hash) : false;
    if (!matches) throw httpError(401, 'El correo o la contraseña no son correctos.');

    await new Promise((resolve, reject) => {
      request.session.regenerate((error) => error ? reject(error) : resolve());
    });
    request.session.admin = { id: String(admin.admin_id), email: admin.email };
    request.session.csrfToken = crypto.randomBytes(32).toString('hex');
    await new Promise((resolve, reject) => {
      request.session.save((error) => error ? reject(error) : resolve());
    });
    response.json({ authenticated: true, email: admin.email, csrfToken: request.session.csrfToken });
  }));

  router.post('/logout', requireAdmin, requireCsrf, (request, response, next) => {
    request.session.destroy((error) => {
      if (error) return next(error);
      response.clearCookie('petnica.sid');
      response.status(204).end();
    });
  });

  router.use(requireAdmin);
  router.use((request, response, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return requireCsrf(request, response, next);
    next();
  });

  router.get('/overview', asyncRoute(async (_request, response) => {
    const [products, orders, categories] = await Promise.all([
      pool.query(`
        SELECT p.product_id AS id, p.name, p.slug, p.description, p.target_species AS species,
               p.category_id AS "categoryId", c.name AS category, p.is_active AS active,
               COALESCE(
                 (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.product_id
                  ORDER BY pi.sort_order, pi.image_id LIMIT 1),
                 '/images/' || p.slug || '.jpg'
               ) AS image,
               COALESCE(json_agg(json_build_object(
                 'id', v.variant_id, 'sku', v.sku, 'presentation', v.presentation,
                 'price', v.price_nio, 'stock', v.stock_qty, 'active', v.is_active
               ) ORDER BY v.variant_id) FILTER (WHERE v.variant_id IS NOT NULL), '[]'::json) AS variants
        FROM products p
        JOIN categories c ON c.category_id = p.category_id
        LEFT JOIN product_variants v ON v.product_id = p.product_id
        GROUP BY p.product_id, c.name ORDER BY p.created_at DESC, p.product_id DESC
      `),
      pool.query(`
        SELECT o.order_id AS id, o.status, o.payment_method AS "paymentMethod",
               o.subtotal_nio AS subtotal, o.discount_nio AS discount,
               o.shipping_nio AS shipping, o.total_nio AS total, o.created_at AS "createdAt",
               o.shipping_address AS "shippingAddress", o.notes,
               (SELECT pl.name FROM petbox_subscriptions s
                JOIN petbox_plans pl ON pl.plan_id = s.plan_id
                WHERE s.subscription_id = o.petbox_subscription_id) AS "petboxName",
               c.first_name AS "firstName", c.last_name AS "lastName",
               c.email, c.phone_whatsapp AS phone,
               COALESCE(pay.status, 'pendiente') AS "paymentStatus",
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
        GROUP BY o.order_id, c.first_name, c.last_name, c.email, c.phone_whatsapp, pay.status
        ORDER BY o.created_at DESC LIMIT 100
      `),
      pool.query('SELECT category_id AS id, name FROM categories ORDER BY name'),
    ]);
    response.set('Cache-Control', 'no-store');
    response.json({ products: products.rows, orders: orders.rows, categories: categories.rows });
  }));

  router.post('/products', asyncRoute(async (request, response) => {
    const name = text(request.body.name, 'El nombre', 150);
    const description = text(request.body.description, 'La descripción', 5000, true);
    const slugInput = text(request.body.slug || slugify(name), 'El slug', 160);
    const slug = slugify(slugInput);
    const categoryId = positiveId(request.body.categoryId, 'La categoría');
    const species = request.body.species;
    const sku = text(request.body.sku, 'El SKU', 40).toUpperCase();
    const presentation = text(request.body.presentation, 'La presentación', 60);
    const price = nonNegativeNumber(request.body.price, 'El precio', { max: 99999999.99 });
    const stock = nonNegativeNumber(request.body.stock, 'El inventario', { integer: true, max: 2147483647 });
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw httpError(400, 'El slug solo puede contener letras, números y guiones.');
    if (!SPECIES.includes(species)) throw httpError(400, 'Selecciona perro, gato o ambos.');
    const result = await withTransaction(pool, async (client) => {
      const category = await client.query('SELECT 1 FROM categories WHERE category_id = $1', [categoryId]);
      if (!category.rowCount) throw httpError(400, 'La categoría seleccionada no existe.');
      const product = await client.query(
        `INSERT INTO products (category_id, name, slug, description, target_species)
         VALUES ($1, $2, $3, $4, $5) RETURNING product_id`,
        [categoryId, name, slug, description, species],
      );
      const variant = await client.query(
        `INSERT INTO product_variants (product_id, sku, presentation, price_nio, stock_qty)
         VALUES ($1, $2, $3, $4, $5) RETURNING variant_id`,
        [product.rows[0].product_id, sku, presentation, price, stock],
      );
      return { id: String(product.rows[0].product_id), variantId: String(variant.rows[0].variant_id) };
    });
    response.status(201).json(result);
  }));

  router.put('/products/:productId', asyncRoute(async (request, response) => {
    const productId = positiveId(request.params.productId, 'El producto');
    const name = text(request.body.name, 'El nombre', 150);
    const description = text(request.body.description, 'La descripción', 5000, true);
    const slug = slugify(text(request.body.slug, 'El slug', 160));
    const categoryId = positiveId(request.body.categoryId, 'La categoría');
    const species = request.body.species;
    const active = request.body.active;
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw httpError(400, 'El slug solo puede contener letras, números y guiones.');
    if (!SPECIES.includes(species) || typeof active !== 'boolean') throw httpError(400, 'Revisa la especie y el estado del producto.');
    const result = await pool.query(
      `UPDATE products SET name = $1, slug = $2, description = $3, category_id = $4,
                           target_species = $5, is_active = $6
       WHERE product_id = $7 RETURNING product_id`,
      [name, slug, description, categoryId, species, active, productId],
    );
    if (!result.rowCount) throw httpError(404, 'No se encontró el producto.');
    response.json({ ok: true });
  }));

  router.post('/products/:productId/variants', asyncRoute(async (request, response) => {
    const productId = positiveId(request.params.productId, 'El producto');
    const sku = text(request.body.sku, 'El SKU', 40).toUpperCase();
    const presentation = text(request.body.presentation, 'La presentación', 60);
    const price = nonNegativeNumber(request.body.price, 'El precio', { max: 99999999.99 });
    const stock = nonNegativeNumber(request.body.stock, 'El inventario', { integer: true, max: 2147483647 });
    const result = await pool.query(
      `INSERT INTO product_variants (product_id, sku, presentation, price_nio, stock_qty)
       SELECT product_id, $2, $3, $4, $5 FROM products WHERE product_id = $1
       RETURNING variant_id`,
      [productId, sku, presentation, price, stock],
    );
    if (!result.rowCount) throw httpError(404, 'No se encontró el producto.');
    response.status(201).json({ id: String(result.rows[0].variant_id) });
  }));

  router.put('/variants/:variantId', asyncRoute(async (request, response) => {
    const variantId = positiveId(request.params.variantId, 'La variante');
    const sku = text(request.body.sku, 'El SKU', 40).toUpperCase();
    const presentation = text(request.body.presentation, 'La presentación', 60);
    const price = nonNegativeNumber(request.body.price, 'El precio', { max: 99999999.99 });
    const stock = nonNegativeNumber(request.body.stock, 'El inventario', { integer: true, max: 2147483647 });
    const active = request.body.active;
    if (typeof active !== 'boolean') throw httpError(400, 'Selecciona el estado de la variante.');
    const result = await pool.query(
      `UPDATE product_variants
       SET sku = $1, presentation = $2, price_nio = $3, stock_qty = $4, is_active = $5
       WHERE variant_id = $6 RETURNING variant_id`,
      [sku, presentation, price, stock, active, variantId],
    );
    if (!result.rowCount) throw httpError(404, 'No se encontró la variante.');
    response.json({ ok: true });
  }));

  router.post('/products/:productId/image', (request, response, next) => {
    uploadImage(request, response, (error) => {
      if (error) return next(error);
      next();
    });
  }, asyncRoute(async (request, response) => {
    const productId = positiveId(request.params.productId, 'El producto');
    if (!request.file) throw httpError(400, 'Selecciona una imagen JPG, PNG o WebP de hasta 5 MB.');
    const type = imageType(request.file.buffer);
    if (!type) throw httpError(400, 'El archivo no contiene una imagen JPG, PNG o WebP válida.');
    const product = await pool.query('SELECT 1 FROM products WHERE product_id = $1', [productId]);
    if (!product.rowCount) throw httpError(404, 'No se encontró el producto.');
    const filename = `admin-${crypto.randomUUID()}.${type.extension}`;
    const filePath = path.join(imageDirectory, filename);
    await fs.mkdir(imageDirectory, { recursive: true });
    await fs.writeFile(filePath, request.file.buffer, { flag: 'wx' });
    const url = `/images/${filename}`;
    try {
      await withTransaction(pool, async (client) => {
        await client.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
        await client.query(
          'INSERT INTO product_images (product_id, url, sort_order) VALUES ($1, $2, 0)',
          [productId, url],
        );
      });
    } catch (error) {
      await fs.unlink(filePath).catch((unlinkError) => {
        console.error('No se pudo limpiar una imagen tras un error de base de datos:', unlinkError);
      });
      throw error;
    }
    response.status(201).json({ url });
  }));

  router.delete('/products/:productId/image', asyncRoute(async (request, response) => {
    const productId = positiveId(request.params.productId, 'El producto');
    await pool.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
    response.status(204).end();
  }));

  router.put('/orders/:orderId/status', asyncRoute(async (request, response) => {
    const orderId = positiveId(request.params.orderId, 'El pedido');
    const status = request.body.status;
    if (!ORDER_STATUSES.includes(status)) throw httpError(400, 'El estado del pedido no es válido.');
    await withTransaction(pool, async (client) => {
      const orderResult = await client.query(
        'SELECT order_id, status, petbox_subscription_id FROM orders WHERE order_id = $1 FOR UPDATE',
        [orderId],
      );
      if (!orderResult.rowCount) throw httpError(404, 'No se encontró el pedido.');
      const previous = orderResult.rows[0].status;
      if (previous === status) return;
      if (previous === 'cancelado' && status !== 'cancelado') {
        const items = await client.query(
          'SELECT variant_id, quantity FROM order_items WHERE order_id = $1 ORDER BY variant_id FOR UPDATE',
          [orderId],
        );
        for (const item of items.rows) {
          const updated = await client.query(
            `UPDATE product_variants SET stock_qty = stock_qty - $1
             WHERE variant_id = $2 AND stock_qty >= $1`,
            [item.quantity, item.variant_id],
          );
          if (!updated.rowCount) throw httpError(409, 'No hay suficiente inventario para reactivar este pedido.');
        }
      } else if (previous !== 'cancelado' && status === 'cancelado') {
        const items = await client.query(
          'SELECT variant_id, quantity FROM order_items WHERE order_id = $1 ORDER BY variant_id FOR UPDATE',
          [orderId],
        );
        for (const item of items.rows) {
          await client.query(
            'UPDATE product_variants SET stock_qty = stock_qty + $1 WHERE variant_id = $2',
            [item.quantity, item.variant_id],
          );
        }
      }
      await client.query(
        `UPDATE orders SET status = $1,
             delivered_at = CASE WHEN $1 = 'entregado' THEN COALESCE(delivered_at, now()) ELSE NULL END
         WHERE order_id = $2`,
        [status, orderId],
      );
      if (orderResult.rows[0].petbox_subscription_id && status === 'cancelado') {
        await client.query(
          `UPDATE petbox_subscriptions SET status = 'cancelada'
           WHERE subscription_id = $1 AND status <> 'cancelada'`,
          [orderResult.rows[0].petbox_subscription_id],
        );
      } else if (orderResult.rows[0].petbox_subscription_id && previous === 'cancelado') {
        await client.query(
          `UPDATE petbox_subscriptions SET status = 'activa'
           WHERE subscription_id = $1 AND status = 'cancelada'`,
          [orderResult.rows[0].petbox_subscription_id],
        );
      }
    });
    response.json({ ok: true });
  }));

  router.put('/orders/:orderId/payment', asyncRoute(async (request, response) => {
    const orderId = positiveId(request.params.orderId, 'El pedido');
    const status = request.body.status;
    if (!PAYMENT_STATUSES.includes(status)) throw httpError(400, 'El estado del pago no es válido.');
    const result = await pool.query(
      `UPDATE payments SET status = $1,
             paid_at = CASE WHEN $1 = 'verificado' THEN COALESCE(paid_at, now()) ELSE NULL END
       WHERE payment_id = (
         SELECT payment_id FROM payments WHERE order_id = $2 ORDER BY payment_id DESC LIMIT 1
       ) RETURNING payment_id`,
      [status, orderId],
    );
    if (!result.rowCount) throw httpError(404, 'Este pedido no tiene un pago registrable.');
    response.json({ ok: true });
  }));

  return router;
}

module.exports = { createAdminRouter };
