#!/bin/bash
# Respaldo de la base de datos hacia un almacenamiento compatible con S3 (por ejemplo el Bucket de Railway).
# Variables:
#   DATABASE_URL        dirección de la base (en Railway, la PRIVADA del servicio PostgreSQL)
#   Almacenamiento S3   se aceptan los nombres de Railway (AWS_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
#                       AWS_S3_BUCKET_NAME, AWS_DEFAULT_REGION) o sus equivalentes cortos (ENDPOINT, ACCESS_KEY_ID,
#                       SECRET_ACCESS_KEY, BUCKET, REGION)
#   RETENCION_DIAS      días que se conservan los respaldos (por defecto 14)
set -euo pipefail

: "${DATABASE_URL:?Falta DATABASE_URL (dirección de la base de datos)}"

ENDPOINT="${AWS_ENDPOINT_URL:-${ENDPOINT:-}}"
ACCESO="${AWS_ACCESS_KEY_ID:-${ACCESS_KEY_ID:-}}"
SECRETO="${AWS_SECRET_ACCESS_KEY:-${SECRET_ACCESS_KEY:-}}"
BUCKET="${AWS_S3_BUCKET_NAME:-${BUCKET:-}}"
REGION="${AWS_DEFAULT_REGION:-${REGION:-us-east-1}}"
RETENCION_DIAS="${RETENCION_DIAS:-14}"

faltan=""
[ -n "$ENDPOINT" ] || faltan="$faltan ENDPOINT"
[ -n "$ACCESO" ]   || faltan="$faltan ACCESS_KEY_ID"
[ -n "$SECRETO" ]  || faltan="$faltan SECRET_ACCESS_KEY"
[ -n "$BUCKET" ]   || faltan="$faltan BUCKET"
if [ -n "$faltan" ]; then
  echo "ERROR: faltan variables del almacenamiento S3:$faltan" >&2
  exit 1
fi

# rclone lee su configuración del entorno: no se escribe ningún archivo con credenciales.
export RCLONE_LOG_LEVEL=ERROR
export RCLONE_CONFIG_DESTINO_TYPE=s3
export RCLONE_CONFIG_DESTINO_PROVIDER=Other
export RCLONE_CONFIG_DESTINO_ENDPOINT="$ENDPOINT"
export RCLONE_CONFIG_DESTINO_ACCESS_KEY_ID="$ACCESO"
export RCLONE_CONFIG_DESTINO_SECRET_ACCESS_KEY="$SECRETO"
export RCLONE_CONFIG_DESTINO_REGION="$REGION"

ARCHIVO="respaldo-$(date -u +%Y-%m-%dT%H-%M-%S).dump"
LOCAL="/tmp/$ARCHIVO"
inicio=$(date +%s)

echo "Respaldando la base de datos…"
pg_dump -Fc --no-owner --no-privileges -f "$LOCAL" "$DATABASE_URL"
TAM=$(stat -c %s "$LOCAL")
echo "Respaldo generado: $ARCHIVO ($TAM bytes)"

echo "Subiendo al almacenamiento…"
rclone copyto "$LOCAL" "DESTINO:$BUCKET/respaldos/$ARCHIVO"

# Comprobar que el archivo llegó completo antes de borrar nada
SUBIDO=$(rclone lsf --format s "DESTINO:$BUCKET/respaldos/$ARCHIVO" | head -1)
if [ "$SUBIDO" != "$TAM" ]; then
  echo "ERROR: el archivo subido pesa '$SUBIDO' y el original $TAM bytes." >&2
  exit 1
fi

echo "Borrando respaldos de más de $RETENCION_DIAS días…"
rclone delete "DESTINO:$BUCKET/respaldos" --min-age "${RETENCION_DIAS}d"

rm -f "$LOCAL"
echo "Respaldo completo: respaldos/$ARCHIVO en $(( $(date +%s) - inicio )) s. Respaldos guardados:"
rclone lsf "DESTINO:$BUCKET/respaldos" | sort | tail -5
