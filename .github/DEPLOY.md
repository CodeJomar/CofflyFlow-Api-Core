# Checklist de despliegue (Railway)

Todo el sistema vive en **un proyecto de Railway con tres servicios**:

| Servicio | Origen | Rama |
|---|---|---|
| **CofflyFlow-DB-Core** | Plantilla PostgreSQL de Railway (con volumen) | — |
| **CofflyFlow-Api-Core** | Este repositorio (raíz = raíz del servicio, `Dockerfile`) | `prod` |
| **CofflyFlow-Web-Core** | Repositorio `CofflyFlow-Web-Core` (`Dockerfile`) | `prod` |

Opcional: un servicio **Redis** (sin él, los límites de peticiones y los eventos en tiempo real quedan por instancia; por eso la API debe tener **una sola réplica**).

> Los ajustes que se hacen en el panel de Railway (healthcheck, reinicio, dominios) valen más que `railway.json`: la configuración como código está obsoleta en Railway y puede ignorarse.

## 0. Antes de tocar Railway
- [ ] Crear la rama `prod` desde `develop` en ambos repositorios y protegerla (ver `GITFLOW.md`).
- [ ] Mantener el despliegue automático de cada servicio activado, o desplegar a mano tras cada cambio.

## 1. Base de datos (una sola vez)

La base se crea desde tu PC con la **dirección pública** del servicio PostgreSQL (Settings → Networking → TCP Proxy). La dirección lleva la contraseña: se define en la terminal y no se guarda en archivos.

1. `npm run db:crear` — ejecuta `database/database.sql` (partes 1 a 11) como una sola transacción. Se detiene si la base ya tiene el esquema. Usa `DB_SSL=true` con la dirección pública.
2. `npm run seed:permisos` — crea los cargos base (WAITER, BARISTA, CASHIER, OPERATOR), los módulos, las acciones y la matriz de permisos. Se puede repetir sin duplicar.
3. `npm run seed:owner` — crea la cuenta del propietario (`OWNER_EMAIL`, `OWNER_NAME`, `OWNER_PASSWORD`).

Una base nueva **no** necesita las migraciones 01 a 07: `database.sql` ya las incluye. Las migraciones sirven solo para bases creadas con una versión anterior.

Al terminar, **apagar el TCP Proxy** de la base: dentro de Railway la API se conecta por la red privada.

## 2. Variables del servicio API
Variables **obligatorias** (si falta o es débil algo, la API NO arranca; está hecho a propósito):

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` (fija el puerto para que el dominio público y la dirección privada coincidan) |
| `DATABASE_URL` | dirección **privada** de la base (`…@postgres.railway.internal:5432/railway`) |
| `DB_SSL` | `false` dentro de la red privada de Railway (`true` si se usa la dirección pública) |
| `JWT_SECRET` | aleatorio de 32+ caracteres |
| `OTP_HMAC_SECRET` | otro aleatorio **distinto** de 32+ caracteres |
| `CORS_ORIGIN` | URL pública de la web, sin barra final |
| `WEB_URL` | URL pública de la web con `https://` (enlaces de activación por correo) |
| `MAIL_HOST` · `MAIL_PORT` · `MAIL_USERNAME` · `MAIL_PASSWORD` · `MAIL_FROM` | servidor SMTP. Con Resend: `smtp.resend.com`, `465`, `resend`, la clave de API de Resend como contraseña y `onboarding@resend.dev` como remitente. |
| `RESEND_API_KEY` | opcional: la misma clave de Resend. Con ella los correos salen por la API HTTPS de Resend (sirve si el proveedor bloquea los puertos SMTP); sin ella se usa el SMTP anterior. |
| `TRUSTED_PROXY_HOPS` | `2` (navegador → Railway → Next.js → API por la red privada; con la API expuesta directamente serían menos) |

Con el remitente de pruebas `onboarding@resend.dev`, Resend solo entrega correos al titular de la cuenta; para escribir a cualquier empleado hay que verificar un dominio propio en Resend.

Opcionales: `REDIS_URL`, `OBSERVE_APP_KEY` + `OBSERVE_APP_SECRET` (APM), `JWT_EXPIRATION`, `JWT_REFRESH_EXPIRATION`.

No definir: `COOKIE_SECURE=false` (en producción la API se niega a arrancar).

Ajustes del panel: **Healthcheck Path** `/health/ready`, **Serverless** apagado, **una réplica**, reinicio "On Failure".

## 3. Variables del servicio Web
| Variable | Valor |
|---|---|
| `API_INTERNAL_URL` | dirección privada de la API con su puerto (`http://<nombre-privado>.railway.internal:4000`). Se fija al compilar: tras cambiarla hay que redesplegar la web. |
| `NEXT_PUBLIC_WS_URL` | URL pública de la API (`https://…up.railway.app`) para el WebSocket del KDS. También se fija al compilar; si falta, el KDS usa solo sondeo. |

Ajustes del panel: **Healthcheck Path** `/login` (la raíz `/` redirige y Railway espera un 200), **Serverless** apagado, **Skipped Builds** apagado (las variables de build deben reconstruir la web), **CDN Caching** apagado.

## 4. Después del primer despliegue
- [ ] `GET /health/ready` de la API responde 200.
- [ ] Abrir la web, entrar con la cuenta OWNER y **cambiar su contraseña** desde Mi perfil.
- [ ] Abrir caja, tomar un pedido, verlo en el KDS y cobrarlo.
- [ ] Comprobar que el KDS muestra "En vivo" (WebSocket conectado).
- [ ] Quitar `OWNER_PASSWORD` del entorno de la terminal; no debe quedar en ninguna variable de Railway.
- [ ] Hacer un respaldo (sección 5).

## 5. Respaldos

El plan actual de Railway no incluye respaldos automáticos (solo el plan Pro). Se hacen con Docker, sin instalar PostgreSQL:

- `npm run db:respaldo` — crea `respaldos/respaldo-<fecha>.dump` con `pg_dump`. Usa la dirección pública de la base y una imagen de PostgreSQL de versión igual o mayor que la del servidor (`PG_IMAGEN`, por defecto `postgres:18`).
- `npm run db:respaldo -- probar` — restaura el último respaldo en una base temporal, cuenta tablas y filas y mide el tiempo de recuperación (RTO).
- `RESPALDOS_DIR` permite guardar los respaldos en una carpeta concreta, por ejemplo una carpeta sincronizada con OneDrive.

La carpeta `respaldos/` contiene datos reales y está en `.gitignore`.

### Respaldo automático

El servicio `respaldo-worker/` (ver su `README.md`) hace el respaldo solo: un cron en Railway ejecuta `pg_dump` por la red privada, sube el archivo al almacenamiento S3 de Railway (Bucket), comprueba su tamaño y borra los de más de 14 días. No necesita el TCP Proxy de la base. Los respaldos del Bucket viven en el mismo proyecto de Railway: conviene bajar una copia a tu equipo de vez en cuando con `npm run db:respaldo`.

PostgreSQL de Railway no trae un agente de respaldos: no tiene `pg_cron` ni `pgAgent` disponibles. Para automatizar, el respaldo debe ejecutarlo un proceso externo (una tarea programada en un equipo, o un servicio con cron en Railway).

## 6. Pendiente conocido
- Dominio propio verificado en Resend para enviar correos a cualquier destinatario.
- Pruebas con base de datos (hoy las pruebas automáticas cubren configuración, permisos y reglas de entrada).
