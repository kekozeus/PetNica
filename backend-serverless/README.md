# PetNica serverless

Esta carpeta es un despliegue independiente para Vercel: contiene el backend, sus migraciones y el sitio estático. La versión Express tradicional y su configuración local se mantienen en `../backend`.

## Desarrollo local

1. Copia `.env.example` como `.env` dentro de esta carpeta y configura la conexión PostgreSQL y `SESSION_SECRET`. No copies ni publiques credenciales en el repositorio.
2. Instala y ejecuta desde esta carpeta:

   ```powershell
   npm install
   npm run dev
   ```

3. Comprueba `http://localhost:3000/api/health`.

## Imágenes de producto

Las imágenes usan `image-storage.js`, con dos destinos:

- **Supabase Storage** cuando `PRODUCT_IMAGE_STORAGE=supabase`, o cuando `PRODUCT_IMAGE_STORAGE=auto` y hay credenciales configuradas.
- **Disco local** en `public/images` para desarrollo, o en la ruta opcional `PRODUCT_IMAGE_DIR`.

El objeto se guarda como `products/{productId}/{uuid}.{extension}` (o con el prefijo configurado) y su URL pública se almacena en `product_images.url`. Al reemplazar o quitar una imagen, el backend intenta borrar el objeto anterior sin borrar los fallbacks estáticos `/images/{slug}.jpg`.

### Configurar Supabase

1. En Supabase crea un bucket llamado `product-images` y márcalo como **public**. Las imágenes deben poder leerse sin sesión para que la tienda las muestre.
2. En Vercel configura:
   - `SUPABASE_URL`: URL del proyecto (`https://...supabase.co`).
   - `SUPABASE_SECRET_KEY`: clave secreta de servidor (`sb_secret_...`); `SUPABASE_SERVICE_ROLE_KEY` también se acepta como alias para claves antiguas.
   - `SUPABASE_STORAGE_BUCKET=product-images`.
   - `SUPABASE_PRODUCT_IMAGE_PREFIX=products` (opcional).
   - `PRODUCT_IMAGE_STORAGE=auto`.
3. Nunca agregues la clave secreta al frontend ni la expongas en variables `VITE_*`. El navegador solo recibe la URL pública del objeto.

En desarrollo puedes omitir Supabase; el backend guardará y servirá archivos desde `public/images`. Si ejecutas una función serverless sin Supabase, la subida devuelve un error de configuración porque el disco de Vercel no es persistente.

## Despliegue en Vercel

Configura `backend-serverless` como **Root Directory** del proyecto Vercel. Añade en los ajustes de Vercel, para cada entorno que vayas a usar, las variables `DATABASE_URL`, `SESSION_SECRET`, `PGSSL`, `TRUST_PROXY`, `WHATSAPP_NUMBER` y las variables de Supabase Storage indicadas arriba; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_CALLBACK_URL` son opcionales. No escribas secretos en comandos, archivos versionados ni mensajes.

Después de configurar el acceso a PostgreSQL y las variables directamente en Vercel, instala las dependencias y despliega con `vercel --prod`. `/api/*` se atiende mediante una función serverless; `/admin` y `/admin/login` se reescriben al panel estático.
