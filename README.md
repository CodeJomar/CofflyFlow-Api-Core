# Coffy Flow — Backend API & WebSockets Service

Servicio backend desacoplado que centraliza las reglas de negocio, persistencia relacional y sincronización en tiempo real para la plataforma Coffy Flow[cite: 3].

---

## 🚀 Tecnologías Principales

- **Framework:** NestJS (Node.js con TypeScript)[cite: 3]
- **Arquitectura:** Modular por Capas (Controllers, Services/Use Cases, Repositories)[cite: 3]
- **Base de Datos:** PostgreSQL[cite: 3]
- **ORM / Query Builder:** Drizzle ORM / Prisma[cite: 3]
- **Tiempo Real:** `@nestjs/websockets` (Socket.io) para sincronización KDS y control de stock[cite: 3]
- **Validación y DTOs:** `class-validator`, `class-transformer`
- **Contenedores:** Docker & Docker Compose[cite: 3]

---

## 🏛️ Estructura del Proyecto

El backend organiza cada recurso del negocio dentro de su propio módulo autónomo:

```text
src/
├── common/                       # Filtros globales, interceptores, guards (RBAC) y decoradores
├── config/                       # Configuración de variables de entorno y base de datos
├── database/                     # database.sql (esquema completo) y database-migracion-NN-*.sql (cambios incrementales)
├── docker/                       # Plantilla de docker-compose.yml (API + Web + Redis): copiarla al nivel de Desarrollo/
└── modules/                      # Módulos de Dominio de Negocio
    ├── auth/                     # Autenticación, JWT, RBAC y recuperación de credenciales
    ├── users/                    # Gestión de personal y roles operativos
    ├── menu/                     # Categorías, productos y disponibilidad inmediata
    ├── tables/                   # Identificadores y estados de mesas físicas
    ├── orders/                   # Comandas y persistencia del flujo POS
    ├── kds/                      # Gateways de WebSockets y eventos de cocina
    ├── transactions/             # Cajas, arqueos y conciliación de tickets
    └── dashboard/                # Agregación de métricas e indicadores de venta
```

## 📦 Flujo de Trabajo y Ramas (GitFlow Adaptado)

El detalle del flujo, las reglas de protección de ramas y el despliegue en Railway están en [`.github/GITFLOW.md`](../../.github/GITFLOW.md). Resumen: `feature/*` → `develop` → `prod` (despliega solo). Ramas del proyecto:

- **main:** Rama de documentación del servicio, esquemas técnicos y contratos API.
- **prod:** Versión estable desplegada en el entorno de servidor en la nube.
- **qa:** Entorno de homologación, pruebas unitarias y validación con Postman[cite: 3].
- **develop:** Rama activa de integración de servicios.
- **Ramas de Módulo / Feature (`feature/*`):** Ramas que nacen de `develop`:
  - `feature/backend-auth`
  - `feature/backend-kds`
  - `feature/backend-pos`
  - `feature/backend-transactions`
  - `feature/backend-menu`

## 🛠️ Puesta en Marcha

### Prerrequisitos

- Node.js 20 LTS o superior[cite: 3]
- Docker y Docker Compose (para base de datos local)[cite: 3]

### Instalación

1. Clonar el repositorio:

```bash
git clone https://github.com/tu-organizacion/coffy-flow-backend.git
cd coffy-flow-backend
```

2. Instalar dependencias:

```bash
npm install
```

3. Configurar variables de entorno:

```bash
cp .env.example .env
```

Definir `PORT`, `DATABASE_URL`, `JWT_SECRET` y orígenes CORS permitidos.

4. Levantar la base de datos PostgreSQL en Docker[cite: 3]:

```bash
docker compose up -d
```

5. Ejecutar migraciones:

```bash
npm run db:migrate
```

6. Iniciar el servidor en modo desarrollo:

```bash
npm run start:dev
```

La API estará escuchando en [http://localhost:4000](http://localhost:4000) (o el puerto configurado).

## Inicialización de un despliegue nuevo

1. Base de datos: ejecutar `database/database.sql` (ya incluye roles, cargos y la capa de integridad). Si la base ya existía, aplicar en orden `database/database-migracion-01-auth.sql`, `database-migracion-02-seguridad.sql`, `database-migracion-03-menu-mesas.sql` y `database-migracion-04-caja-dashboard.sql`.
2. Variables de entorno: copiar `.env.example` a `.env` y completar. La API **no arranca** si faltan secretos o son débiles (en producción además exige `CORS_ORIGIN`, `WEB_URL` con https y cookies `Secure`).
3. Matriz de permisos inicial y cargos: `npm run seed:permisos` (idempotente: solo agrega lo que falta). El catálogo de permisos de módulos nuevos se registra solo al arrancar la API.
4. Primera cuenta propietaria: definir `OWNER_EMAIL`, `OWNER_NAME`, `OWNER_PASSWORD` y ejecutar `npm run seed:owner`; luego borrar `OWNER_PASSWORD` del entorno.

En el contenedor los mismos pasos corren con `node dist/scripts/seed-permisos.js` y `node dist/scripts/seed-owner.js`.

## Observabilidad (opcional)

La API puede enviar trazas y métricas a un APM de terceros (`@nestjs/observe`, https://observe.nestjs.com). Está **apagado por defecto**: no sale ningún dato y no hay errores en los logs. Para activarlo, crea un servicio en esa web y define `OBSERVE_APP_KEY` y `OBSERVE_APP_SECRET` (juntas) en el entorno; opcionalmente `OBSERVE_SERVICE_ID`, `OBSERVE_SERVICE_VERSION` y `OBSERVE_TRACES_SAMPLE_RATE` (0 a 1). No se envía el usuario autenticado ni los logs, y no se trazan `/health` (liveness; `/health/ready` comprueba la base y responde 503 si no responde) ni los endpoints de activación y recuperación.

## Redis (estado compartido)

Con `REDIS_URL` los límites de peticiones, los intentos de login y los eventos WebSocket del KDS son comunes a todas las instancias de la API (las claves de login se guardan hasheadas). Sin ella, viven en memoria de cada instancia: válido en desarrollo o con una sola instancia. Si Redis cae, la API sigue funcionando y degrada a memoria local. En Railway, añade el plugin de Redis al proyecto y referencia su URL en la variable `REDIS_URL` de la API. `docker compose up` ya levanta uno.

## Roles y permisos

El propietario administra roles desde `/roles` (catálogo en `/roles/catalogo-permisos`). Un módulo nuevo solo necesita `@RequirePermission` en sus endpoints: el catálogo se registra solo al arrancar. Los cambios de permisos de un rol surten efecto de inmediato y quedan auditados.

## Seguridad: resumen de controles

- Autenticación JWT en cookies HttpOnly, sesión verificada en base de datos en cada petición, rotación y detección de reuso del refresh token.
- Autorización global denegada por defecto, permisos por cargo como datos (`rol_permisos`), OWNER con acceso total.
- Límites de peticiones: por IP antes de autenticar, por usuario después, y estrictos en login, OTP y activación.
- Dinero en céntimos, validado y calculado en servidor, con transacciones y bloqueos de fila; descuentos con permiso propio.
- WebSocket del KDS autenticado, con permisos por evento y límite de eventos.
- Auditoría de seguridad inmutable (trigger), restricciones CHECK y unicidad en la base como última línea de defensa.
- Limpieza periódica de sesiones y códigos caducados; cierre ordenado del proceso.
