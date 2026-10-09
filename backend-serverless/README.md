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

## Despliegue en Vercel

Configura `backend-serverless` como **Root Directory** del proyecto Vercel. Añade en los ajustes de Vercel, para cada entorno que vayas a usar, las variables `DATABASE_URL`, `SESSION_SECRET`, `PGSSL`, `TRUST_PROXY` y `WHATSAPP_NUMBER`; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_CALLBACK_URL` son opcionales. No escribas secretos en comandos, archivos versionados ni mensajes.

Después de configurar el acceso a PostgreSQL y las variables directamente en Vercel, instala las dependencias y despliega con `vercel --prod`. `/api/*` se atiende mediante una función serverless y `/admin` se reescribe al panel estático.

Vercel no proporciona disco persistente para las imágenes subidas desde el panel. Antes de habilitar esas subidas en producción, intégralas con almacenamiento de objetos persistente.
