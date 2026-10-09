# PetNica

Tienda web en español para perros y gatos, conectada al esquema PostgreSQL de `backend/data/petnica_schema.sql`. El catálogo, las variantes, el inventario, las zonas de envío y los planes PetBox se leen de la base de datos. Los pedidos se guardan en `orders` y `order_items`; si incluyen una PetBox, también se crean la mascota y su suscripción. El inventario y el uso de descuentos se actualizan dentro de la misma transacción. El backend completo está en `backend/`; el servidor sirve el sitio estático desde `public/`.

La variante preparada para Vercel está en `backend-serverless/`; su guía de configuración y despliegue está en `backend-serverless/README.md`.

## Estructura del repositorio

- `public/`: tienda y panel de administración.
- `backend/`: servidor Express, migraciones y esquema PostgreSQL para desarrollo o despliegue tradicional.
- `backend-serverless/`: variante independiente para desplegar en Vercel.
- `PetNica-Home.html`: prototipo de la página de inicio.

Se versionan el código, los esquemas SQL de ejemplo, los archivos `package-lock.json` y las plantillas `.env.example`. No se versionan `node_modules/`, `.vscode/settings.json` (configuración local del editor), archivos `.env` con configuración local ni la carpeta `.vercel/` con metadatos de despliegue. Crea tu propio archivo `.env` a partir de la plantilla correspondiente y nunca agregues credenciales, tokens o datos reales de clientes al repositorio.

## Requisitos

- Node.js 18 o posterior
- PostgreSQL 14 o posterior

## Preparar y ejecutar

1. Crea una base de datos vacía y carga el esquema y sus datos de ejemplo:

   ```powershell
   psql -U postgres -d petnica -f .\backend\data\petnica_schema.sql
   ```

   Si ya tienes las tablas creadas, no vuelvas a ejecutar el archivo completo: contiene `CREATE TABLE` e inserciones de ejemplo.

2. Instala las dependencias:

   ```powershell
   npm --prefix .\backend install
   ```

3. La configuración local está en `backend\.env`. Para una instalación nueva, copia `backend\.env.example` a `backend\.env` y configura `DATABASE_URL` con tu usuario, contraseña, host y nombre de base de datos. Configura `WHATSAPP_NUMBER` con el número de WhatsApp Business en formato internacional, solo dígitos y sin `+`. Asigna un secreto aleatorio a `SESSION_SECRET` (por ejemplo, genera uno con `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`). No publiques ni compartas `.env`.

   Para una base local normalmente basta con `PGSSL=false`. Si tu proveedor requiere TLS, usa `PGSSL=true`. Si despliegas detrás de un proxy HTTPS de confianza, configura `TRUST_PROXY=true`. El acceso con Google es opcional y requiere además configurar `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_CALLBACK_URL`.

4. Inicia el sitio:

   ```powershell
   npm --prefix .\backend run dev
   ```

   Abre <http://localhost:3000>. El endpoint `/api/health` indica si el servidor puede conectarse a PostgreSQL.

## Panel de administración

1. Crea la primera cuenta desde una terminal interactiva:

   ```powershell
   npm --prefix .\backend run admin:create
   ```

   El comando solicita el correo y dos veces la contraseña; la contraseña no se muestra y debe tener al menos 12 caracteres. Solo crea la primera cuenta: no imprime ni guarda la contraseña en el proyecto.

2. Inicia el servidor e ingresa a <http://localhost:3000/admin> con ese correo y contraseña.

3. Desde el panel puedes editar los productos, presentaciones, precios e inventario; agregar productos y sus variantes; subir fotos JPG, PNG o WebP de hasta 5 MB; ver los pedidos recientes; cambiar su estado y actualizar el estado de pago de las transferencias. Cancelar un pedido repone su inventario; reactivarlo vuelve a reservarlo si hay existencias.

La tabla `admin_users` se crea automáticamente al iniciar el servidor. El archivo `backend/data/admin-schema.sql` contiene la misma definición para inspección y configuración manual. Las sesiones duran hasta 8 horas y se guardan en PostgreSQL. En desarrollo, si `SESSION_SECRET` falta, se genera una clave temporal que invalida las sesiones al reiniciar; en producción el servidor exige que se configure.

## Cuentas de clientes, Google y pedidos guardados

- Los clientes pueden registrarse e iniciar sesión desde **Mi cuenta** en la tienda. Las contraseñas se guardan con bcrypt, nunca en texto plano. Para evitar que alguien reclame pedidos ajenos, se requiere iniciar sesión o acceder con un correo de Google verificado.
- El carrito de una visita sin iniciar sesión se conserva en el navegador. Al entrar a una cuenta, se combina con el carrito guardado en PostgreSQL y se sincroniza. Para confirmar un pedido se requiere una cuenta con sesión iniciada. El WhatsApp es opcional al registrarse y en checkout; la dirección sigue siendo necesaria para la entrega.
- Los clientes con sesión pueden consultar sus últimos 100 pedidos. **Ver comprobante / Imprimir** genera desde los datos guardados del pedido un documento imprimible que se puede guardar como PDF. Es un comprobante informativo, no una factura fiscal.
- Al seleccionar un producto se abre su ficha con variantes, promedio y comentarios de clientes, además de opiniones separadas sobre las entregas. Solo los clientes con sesión pueden publicar; PetNica comprueba que el pedido les pertenece, contiene el producto y tiene estado **entregado**. Cada compra se puede valorar una vez por producto y la entrega una vez por pedido.
- La migración `backend/data/product-reviews-schema.sql` se aplica automáticamente al iniciar el servidor. Si la base ya existe, no vuelvas a ejecutar el esquema completo: reinicia el servidor y la migración creará las tablas e índices de opiniones sin alterar los pedidos ni el inventario.
- Para habilitar Google, crea un cliente OAuth de tipo aplicación web en Google Cloud Console y agrega el callback exacto de tu sitio a **Authorized redirect URIs**. En desarrollo local con el puerto 3000, usa `http://localhost:3000/api/account/google/callback`. Coloca el ID y el secreto en `.env`. Para otro puerto o dominio, configura `GOOGLE_CALLBACK_URL` con la misma URL autorizada en Google. No compartas el secreto OAuth.
- Un correo Google verificado puede asociarse a pedidos de invitado anteriores con ese mismo correo. Por seguridad, Google no se vincula automáticamente a una cuenta que ya tenga contraseña; esa cuenta continúa usando correo y contraseña.
- En despliegues públicos, usa HTTPS y un secreto `SESSION_SECRET` aleatorio. El usuario de PostgreSQL necesita permisos para las migraciones automáticas de `customers` y `cart_petbox_items`.

## Agregar tus imágenes

- **Productos:** agrega filas a `product_images` con el `product_id` y la ruta o URL de la imagen. Se muestra primero la imagen con menor `sort_order`. Si un producto no tiene imágenes registradas, la tienda busca `public/images/<slug>.jpg`.
- **Portada:** agrega `public/images/hero-perro.png` y `public/images/hero-gato.png`. Si aún no tienes esas imágenes, se muestran emojis como alternativa.

Las imágenes locales deben guardarse dentro de `public/images/`; por ejemplo, si el producto tiene el slug `pelota-goma-resistente`, su archivo alternativo sería `public/images/pelota-goma-resistente.jpg`.

## Pedidos y pagos

El cliente confirma sus datos, dirección y método de pago en el carrito. El servidor obtiene precios y envío de PostgreSQL, comprueba stock y descuentos y registra el pedido. El pago por transferencia queda pendiente de verificación; no se procesan tarjetas. Al terminar, el cliente puede continuar la conversación por WhatsApp para coordinar la entrega.
