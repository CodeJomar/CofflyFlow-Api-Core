-- MIGRACIÓN 08 — Cifrado de datos personales del personal (DNI y teléfono)
--  * Amplía las columnas para guardar el valor cifrado (AES-256-GCM, prefijo "enc1:").
--  * No cambia ni borra datos: los valores en texto plano existentes se siguen leyendo y se cifran con
--    `npm run seed:cifrar-pii` (una vez, con la misma DATABASE_URL).
-- Se puede aplicar más de una vez. Es compatible con la versión anterior de la API.
-- =====================================================================================================================
BEGIN;
ALTER TABLE usuarios ALTER COLUMN dni      TYPE VARCHAR(255);
ALTER TABLE usuarios ALTER COLUMN telefono TYPE VARCHAR(255);
COMMIT;
