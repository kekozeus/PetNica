# PetNica — Backend Go para Vercel Functions

Reescritura en Go del backend Node/Express `backend-serverless`. Se despliega
**dentro del proyecto Vercel `petnica-frontend`**: el mismo deployment sirve el
frontend (`public/`) y la API Go (`api/route.go`), todo same-origin.

## Estructura

- `api/route.go` — entrypoint de la Vercel Function (paquete `handler`).
- `app/` — toda la lógica (catálogo, pedidos, admin, customer, sesiones PG,
  rate limit, imágenes). NO usar `internal/`: Vercel compila `api/` fuera del
  módulo y la regla de visibilidad de `internal` rompe el build.
- `cmd/server` — servidor local (`go run ./cmd/server`, usa `.env`).
- `cmd/create-admin` — CLI para crear usuarios admin.
- `cmd/create-courier` — CLI para crear usuarios repartidor
  (`go run ./cmd/create-courier <email> <password>`).
- `public/` — build del frontend (se genera, no se edita a mano).
- `app/migrations/` — SQL embebido que `initialize()` aplica al arrancar.

## Desarrollo local

```bash
cp .env.example .env   # DATABASE_URL, PGSSL, SESSION_SECRET, TRUST_PROXY
go run ./cmd/server    # http://localhost:3000
```

## Deploy a producción

```bash
# 1. Reconstruir el frontend y copiarlo a public/
npm --prefix ../Rfrontend run build:vercel
rm -rf public/* && cp -R ../Rfrontend/dist/. public/

# 2. Deploy (el directorio ya está linkeado a petnica-frontend)
vercel deploy --prod
```

Env vars configuradas en el proyecto (Production): `DATABASE_URL`,
`SESSION_SECRET` (misma del backend anterior → las sesiones sobreviven),
`PGSSL`, `TRUST_PROXY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CALLBACK_URL`.
Falta `GOOGLE_CLIENT_SECRET` para activar OAuth de Google.

Correos de comprobante de pedido (Resend): `RESEND_API_KEY` habilita el envío
(sin ella no se envía nada) y `RESEND_FROM` define el remitente verificado.
Con el remitente de pruebas `onboarding@resend.dev` solo llega al correo
dueño de la cuenta Resend; para enviar a clientes hay que verificar un dominio.

## Notas de paridad con el backend Node

- NUMERIC de Postgres se expone como string (igual que node-pg): `rating`,
  `fee`, `price` de planes, `subtotal`/`total` de pedidos.
- IDs BIGINT como string; INT/SMALLINT como número.
- Sesiones en `petnica_sessions` con formato express-session + cookie
  `petnica.sid` firmada `s:<sid>.<hmac-sha256>` — interoperables con Node.
- `json_build_object` (no jsonb) + structs tipados → `520.00` → `520`.
- `DefaultQueryExecMode = QueryExecModeExec`: obligatorio con el pooler de
  Supabase (PgBouncer invalida prepared statements).
- `sess` se inserta como `string`, nunca `[]byte` (bytea rompe la columna json).

## Repartidores y términos de compra

- Roles en `admin_users.role` (`admin` | `repartidor`). `requireAdmin` rechaza
  repartidores y `requireCourier` solo acepta `role='repartidor'`.
- API `/api/delivery/*` (app/delivery.go) y panel `/repartidor` en el frontend.
- El repartidor marca `en_camino` y confirma la entrega con video (subida
  firmada a Supabase Storage vía `/video-url`, o multipart `/video` en local)
  más firma/nombre de quien recibió → `order_deliveries` + `orders.status='entregado'`.
- `customers.terms_accepted_at` registra la aceptación de condiciones en el
  checkout (`termsAccepted` en el body de `/api/orders`); el frontend guarda
  además `petnica.termsAccepted` en localStorage para no repetir el aviso.
- Cupones `first_order_only` (PETNICA10): `createOrder` verifica dentro de la
  transacción que el cliente no tenga pedidos no cancelados; la sesión expone
  `promoEligible` para ocultar el promo en el frontend.

## IMPORTANTE

`Rfrontend` ya NO es la fuente de deploy de petnica-frontend — este directorio
sí. Un `vercel deploy --prod` desde `Rfrontend` publicaría un deployment solo
frontend (su `vercel.json` sigue apuntando a `backend-serverless-cyan`, que
sigue activo como respaldo).
