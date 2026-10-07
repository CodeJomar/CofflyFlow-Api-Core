# Checklist de despliegue (Railway)

Este repositorio es el servicio **API** de Railway (raíz del repositorio = raíz del servicio, con su `railway.json`), conectado a la rama **`prod`** con *Wait for CI* activado (ver `GITFLOW.md`).
Opcional pero recomendado: un tercer servicio **Redis** (plugin de Railway).

## 0. Antes de tocar Railway
- [ ] Crear la rama `prod` desde `develop` y proteger `prod` y `develop` (ver `GITFLOW.md`).
- [ ] Base de datos (carpeta `database/` de este repositorio): las migraciones `database/database-migracion-01` a `06` se aplican **en orden** sobre la base de producción. Si producción usa la misma base de Supabase que desarrollo, ya están aplicadas (se pueden reaplicar sin riesgo). Si es una base nueva, crear primero el esquema con `database.sql` (ya incluye todo).
- [ ] Sembrar una sola vez, contra la base de producción: `npm run seed:permisos` y `npm run seed:owner` (este último lee `OWNER_EMAIL`, `OWNER_NAME`, `OWNER_PASSWORD`; después se pueden quitar de las variables).

## 1. Variables del servicio API
Variables **obligatorias** (si falta o es débil algo de esto, la API NO arranca; está hecho a propósito):

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | cadena del *Transaction Pooler* de Supabase (puerto 6543) |
| `DB_SSL` | `true` |
| `JWT_SECRET` | aleatorio de 32+ caracteres (`openssl rand -base64 48`) |
| `OTP_HMAC_SECRET` | otro aleatorio distinto de 32+ caracteres |
| `CORS_ORIGIN` | URL pública de la web (sin barra final; varias separadas por coma) |
| `WEB_URL` | URL pública de la web, con `https://` (se usa en los enlaces de activación por correo) |
| `MAIL_HOST` · `MAIL_PORT` · `MAIL_USERNAME` · `MAIL_PASSWORD` · `MAIL_FROM` | cuenta SMTP del local |
| `TRUSTED_PROXY_HOPS` | `1` (Railway pone un proxy delante; con `0` todas las IP serían la del proxy) |

Variables **opcionales**: `REDIS_URL` (referencia al servicio Redis; sin ella los límites quedan por instancia), `OBSERVE_APP_KEY` + `OBSERVE_APP_SECRET` (APM; escribe el valor **entre comillas simples** si contiene `$`), `JWT_EXPIRATION`, `JWT_REFRESH_EXPIRATION`, `MAX_LOGIN_ATTEMPTS`, `ACCOUNT_LOCKOUT_MINUTES`, `COOKIE_DOMAIN`, `COOKIE_SAMESITE`, `DB_MAX_CONNECTIONS`. Valores por defecto y comentarios: `.env.example`.

No definir: `PORT` (Railway lo inyecta), `COOKIE_SECURE=false` (en producción la API se niega a arrancar).

Comprobación: el despliegue queda sano cuando `GET /health/ready` responde 200 (Railway lo usa de health check).

## 2. Después del primer despliegue

- [ ] Abrir la web, entrar con la cuenta OWNER y cambiar su contraseña desde el perfil.
- [ ] Crear un usuario de prueba y comprobar que llega el correo de activación (el enlace debe empezar por la `WEB_URL`).
- [ ] Abrir caja, tomar un pedido, verlo en el KDS y cobrarlo.
- [ ] Revisar Observe: deben aparecer trazas de `cofflyflow-api`.
- [ ] Quitar `OWNER_PASSWORD` de las variables.

## 3. Pendiente conocido para producción

- El KDS usa WebSocket. La web reenvía `/api` por HTTP; el WebSocket necesita llegar a la API directamente (dominio público de la API o proxy con soporte WS). Cuando se integre la web con el KDS hay que exponer un dominio de la API y apuntar `CORS_ORIGIN` a la web. El acceso al socket va con el ticket de `POST /api/auth/ws-ticket`, no con cookies.
