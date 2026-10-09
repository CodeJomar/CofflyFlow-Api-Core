# Servicio de respaldo automático

Tarea con cron para Railway: cada vez que corre, genera un respaldo de la base de datos con `pg_dump`, lo sube al
almacenamiento S3 de Railway, comprueba que el archivo llegó completo y borra los respaldos con más de 14 días.
Funciona por la red privada: **no necesita el acceso público (TCP Proxy) de la base de datos**.

## Cómo se crea en Railway

1. En el proyecto, **New → Bucket** (almacenamiento S3). Anota que Railway le da un nombre de bucket y credenciales.
2. **New → GitHub Repository** → este mismo repositorio (`CofflyFlow-Api-Core`), rama `prod`. Nómbralo, por ejemplo, `CofflyFlow-Respaldo`.
3. En el servicio nuevo, **Settings**:
   - **Add Root Directory**: `respaldo-worker` (el Dockerfile está ahí).
   - **Cron Schedule**: por ejemplo `0 8 * * *` (todos los días a las 08:00 UTC, 03:00 en Lima).
   - Dejar **Serverless** apagado, y reinicio en "Never" o "On Failure" con pocos reintentos.
4. En **Variables** del servicio:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | la dirección **privada** de la base de datos (`…@postgres.railway.internal:5432/railway`) |
   | Datos del bucket | referencias a las variables del bucket (endpoint, clave de acceso, clave secreta y nombre del bucket) |
   | `RETENCION_DIAS` | opcional, por defecto `14` |

   El script entiende los nombres que usa Railway (`AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `AWS_S3_BUCKET_NAME`, `AWS_DEFAULT_REGION`) y los equivalentes cortos (`ENDPOINT`, `ACCESS_KEY_ID`,
   `SECRET_ACCESS_KEY`, `BUCKET`, `REGION`). Si falta alguno, la tarea termina con un mensaje que dice cuál.

5. Para probar sin esperar al horario, **Deployments → Redeploy** (o ejecutar la tarea desde el panel) y revisar el log:
   debe terminar con «Respaldo completo» y la lista de los últimos respaldos.

## Cómo se restaura un respaldo

1. Descargar el archivo `.dump` desde el bucket (panel de Railway) a la carpeta `respaldos/` de este repositorio.
2. `npm run db:respaldo -- probar respaldos/<archivo>.dump` lo restaura en una base **temporal** y mide el tiempo.
3. Para restaurar en la base real, usar `pg_restore --clean --if-exists --no-owner -d <dirección de la base> <archivo>.dump`
   con una versión de `pg_restore` igual o mayor que la del servidor (por ejemplo la imagen `postgres:18` de Docker).

## Prueba local

Se probó de punta a punta con una base temporal y un servidor S3 local: genera el respaldo, lo sube, verifica el tamaño,
conserva los anteriores dentro de la retención y el archivo guardado se restaura completo.
