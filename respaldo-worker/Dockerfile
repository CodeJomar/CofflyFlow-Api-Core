# ==============================================================================
# Servicio de respaldo automático de la base de datos (tarea con cron en Railway)
# ==============================================================================
# Genera un respaldo con pg_dump y lo sube al almacenamiento S3 de Railway; borra los más antiguos.
# Se despliega como un servicio aparte con "Root Directory" = respaldo-worker y un Cron Schedule (ver su README).
# La imagen base es la de PostgreSQL 18 para que pg_dump sea de la misma versión que el servidor.
# ==============================================================================
FROM postgres:18

RUN apt-get update \
    && apt-get install -y --no-install-recommends rclone ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY respaldar.sh /usr/local/bin/respaldar.sh
# tr quita los retornos de carro por si el archivo se guardó con finales de línea de Windows
RUN tr -d '\r' < /usr/local/bin/respaldar.sh > /tmp/respaldar.sh && mv /tmp/respaldar.sh /usr/local/bin/respaldar.sh \
    && chmod +x /usr/local/bin/respaldar.sh

# Sin privilegios de administrador
USER postgres

ENTRYPOINT ["/usr/local/bin/respaldar.sh"]
