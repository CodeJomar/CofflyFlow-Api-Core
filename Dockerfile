# ==============================================================================
# Multi-Stage Dockerfile para CofflyFlow API Core (NestJS)
# ==============================================================================
# Base Image: Node.js 22 LTS (Debian Bookworm Slim)
# Razón: Mayor compatibilidad con módulos nativos C++ (bcrypt) y estabilidad glibc,
# evitando problemas de musl libc en Alpine mientras mantiene una superficie mínima.
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Builder (Compilación con TypeScript y Nest CLI)
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /usr/src/app

# Copiar manifiestos de dependencias primero para aprovechar Docker Layer Caching
COPY package.json package-lock.json ./

# Instalar dependencias completas de desarrollo y producción de forma determinista
RUN npm ci

# Copiar configuración y código fuente
COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/

# Compilar proyecto NestJS hacia dist/
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Production Dependencies (Aislamiento exclusivo de node_modules prod)
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS prod-deps

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

# Instalar únicamente dependencias necesarias para producción
RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------------------------------------------
# Stage 3: Runtime (Imagen final limpia y segura para producción)
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

WORKDIR /usr/src/app

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=4000

# Seguridad: Ejecutar como usuario no privilegiado 'node'
USER node

# Copiar artefactos necesarios con propiedad del usuario 'node'
COPY --chown=node:node --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=prod-deps /usr/src/app/package.json ./package.json
COPY --chown=node:node --from=builder /usr/src/app/dist ./dist

# Puerto expuesto por el servicio
EXPOSE 4000

# Healthcheck nativo utilizando fetch de Node 22 (cero herramientas externas adicionales)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 4000) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Ejecución directa como proceso PID 1 (recibe SIGTERM/SIGINT correctamente)
CMD ["node", "dist/main.js"]
