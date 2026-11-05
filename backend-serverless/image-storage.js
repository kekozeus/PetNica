const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cleanPrefix(value) {
  const prefix = String(value || 'products')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,118}$/.test(prefix) || prefix.includes('..')) {
    throw new Error('SUPABASE_PRODUCT_IMAGE_PREFIX debe ser una ruta segura como "products".');
  }
  return prefix;
}

function localPathFromUrl(imageDirectory, url, prefix) {
  if (typeof url !== 'string' || !url.startsWith('/images/')) return null;
  let relative;
  try {
    relative = decodeURIComponent(new URL(url, 'http://local').pathname.slice('/images/'.length));
  } catch {
    return null;
  }
  if (!relative || relative.includes('..') || path.isAbsolute(relative)) return null;
  if (!relative.startsWith(`${prefix}/`) && !relative.startsWith('products/') && !relative.startsWith('admin-')) return null;
  const filePath = path.resolve(imageDirectory, relative);
  const root = path.resolve(imageDirectory);
  return filePath.startsWith(`${root}${path.sep}`) ? filePath : null;
}

function supabasePathFromUrl(url, publicBase, prefix) {
  if (typeof url !== 'string' || !url.startsWith(publicBase)) return null;
  const encodedPath = url.slice(publicBase.length).split('?')[0].split('#')[0];
  if (!encodedPath) return null;
  try {
    const objectPath = decodeURIComponent(encodedPath);
    return objectPath.startsWith(`${prefix}/`) && !objectPath.includes('..') ? objectPath : null;
  } catch {
    return null;
  }
}

function encodeObjectPath(objectPath) {
  return objectPath.split('/').map(encodeURIComponent).join('/');
}

function createImageStorage({ imageDirectory, env = process.env }) {
  const mode = String(env.PRODUCT_IMAGE_STORAGE || 'auto').toLowerCase();
  const supabaseUrl = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  const bucket = String(env.SUPABASE_STORAGE_BUCKET || 'product-images').trim();
  const prefix = cleanPrefix(env.SUPABASE_PRODUCT_IMAGE_PREFIX || 'products');

  if (!['auto', 'local', 'supabase'].includes(mode)) {
    throw new Error('PRODUCT_IMAGE_STORAGE debe ser auto, local o supabase.');
  }

  const supabaseConfigured = Boolean(supabaseUrl && supabaseKey && bucket);
  const useSupabase = mode === 'supabase' || (mode === 'auto' && supabaseConfigured);
  if (useSupabase && !supabaseConfigured) {
    throw new Error('Configura SUPABASE_URL y SUPABASE_SECRET_KEY para usar Supabase Storage.');
  }
  if (useSupabase) {
    try {
      const parsed = new URL(supabaseUrl);
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('protocolo inválido');
    } catch {
      throw new Error('SUPABASE_URL debe ser una URL HTTP o HTTPS válida.');
    }
  }

  const encodedBucket = encodeURIComponent(bucket);
  const publicBase = useSupabase ? `${supabaseUrl}/storage/v1/object/public/${encodedBucket}/` : '';
  const serverless = Boolean(env.VERCEL);

  async function storageRequest(objectPath, options) {
    const response = await fetch(
      `${supabaseUrl}/storage/v1/object/${encodedBucket}/${encodeObjectPath(objectPath)}`,
      {
        method: options.method,
        headers: {
          apikey: supabaseKey,
          authorization: `Bearer ${supabaseKey}`,
          ...options.headers,
        },
        ...(options.body ? { body: options.body } : {}),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`Supabase Storage respondió ${response.status}:`, detail.slice(0, 300));
      throw httpError(502, 'No se pudo completar la operación en Supabase Storage.');
    }
  }

  return {
    driver: useSupabase ? 'supabase' : 'local',
    bucket,
    prefix,
    async save({ productId, buffer, type }) {
      const objectPath = `${prefix}/${productId}/${crypto.randomUUID()}.${type.extension}`;
      if (useSupabase) {
        await storageRequest(objectPath, {
          method: 'POST',
          headers: {
            'Content-Type': type.mime,
            'cache-control': 'max-age=31536000',
            'x-upsert': 'false',
          },
          body: buffer,
        });
        return {
          driver: 'supabase',
          objectPath,
          url: `${publicBase}${encodeObjectPath(objectPath)}`,
        };
      }
      if (serverless) {
        throw httpError(503, 'Configura Supabase Storage para subir imágenes en producción.');
      }

      const filePath = path.join(imageDirectory, objectPath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, buffer, { flag: 'wx' });
      return { driver: 'local', filePath, objectPath, url: `/images/${objectPath}` };
    },
    async remove(stored) {
      if (!stored) return;
      if (stored.driver === 'supabase') {
        await storageRequest(stored.objectPath, { method: 'DELETE' });
        return;
      }
      await fs.unlink(stored.filePath);
    },
    async removeByUrl(url) {
      if (useSupabase) {
        const objectPath = supabasePathFromUrl(url, publicBase, prefix);
        if (objectPath) {
          await storageRequest(objectPath, { method: 'DELETE' });
          return true;
        }
      }
      const filePath = localPathFromUrl(imageDirectory, url, prefix);
      if (!filePath) return false;
      await fs.unlink(filePath);
      return true;
    },
  };
}

module.exports = { createImageStorage };
