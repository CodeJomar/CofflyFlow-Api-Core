-- =========================================================================
-- MIGRACIÓN 01 - AUTH: OWNER/EMPLOYEE + CARGO, ACTIVACIÓN Y RECUPERACIÓN
-- Para bases de datos YA creadas con la versión anterior de database.sql.
-- Una base nueva solo necesita database.sql (ya incluye estos cambios).
-- Ejecutar dentro de una transacción y revisar el resultado antes de COMMIT.
-- =========================================================================

BEGIN;

-- 1. Tipo de cuenta (Account Role) y cargo opcional ------------------------
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tipo_cuenta VARCHAR(10) NOT NULL DEFAULT 'EMPLOYEE';
ALTER TABLE usuarios ALTER COLUMN id_rol DROP NOT NULL;

-- 2. Los usuarios con el antiguo rol 'Admin' pasan a OWNER sin cargo --------
UPDATE usuarios
   SET tipo_cuenta = 'OWNER', id_rol = NULL
 WHERE id_rol IN (SELECT id_rol FROM roles WHERE nombre = 'Admin' AND eliminado = FALSE);

-- 3. Los roles antiguos pasan a ser cargos del dominio ---------------------
UPDATE roles SET nombre = 'WAITER'   WHERE nombre = 'Mozo'   AND eliminado = FALSE
   AND NOT EXISTS (SELECT 1 FROM roles r2 WHERE r2.nombre = 'WAITER'   AND r2.eliminado = FALSE);
UPDATE roles SET nombre = 'BARISTA'  WHERE nombre = 'Barista' AND eliminado = FALSE
   AND NOT EXISTS (SELECT 1 FROM roles r2 WHERE r2.nombre = 'BARISTA'  AND r2.eliminado = FALSE);
UPDATE roles SET nombre = 'CASHIER'  WHERE nombre = 'Cajero'  AND eliminado = FALSE
   AND NOT EXISTS (SELECT 1 FROM roles r2 WHERE r2.nombre = 'CASHIER'  AND r2.eliminado = FALSE);
-- 'Admin' y 'Supervisor' ya no son cargos: se dan de baja lógica si nadie los usa.
UPDATE roles SET eliminado = TRUE
 WHERE nombre IN ('Admin', 'Supervisor') AND eliminado = FALSE
   AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id_rol = roles.id_rol AND u.eliminado = FALSE);

-- 4. Cargos base (si no existen) ------------------------------------------
INSERT INTO roles (nombre, descripcion)
SELECT v.nombre, v.descripcion
  FROM (VALUES
        ('WAITER',   'Mozo: toma de pedidos en salón (POS)'),
        ('BARISTA',  'Barista: preparación y despacho en KDS'),
        ('CASHIER',  'Cajero: cobro y gestión de caja'),
        ('OPERATOR', 'Operador: disponibilidad de menú y consultas operativas')
       ) AS v(nombre, descripcion)
 WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.nombre = v.nombre AND r.eliminado = FALSE);

-- 5. Estados de cuenta ------------------------------------------------------
ALTER TABLE usuarios ALTER COLUMN estado TYPE VARCHAR(25);
ALTER TABLE usuarios ALTER COLUMN estado SET NOT NULL;
ALTER TABLE usuarios ALTER COLUMN estado SET DEFAULT 'pendiente_activacion';

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_tipo_cuenta;
ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_tipo_cuenta CHECK (tipo_cuenta IN ('OWNER', 'EMPLOYEE'));
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_estado;
ALTER TABLE usuarios ADD CONSTRAINT ck_usuarios_estado
    CHECK (estado IN ('pendiente_activacion', 'activo', 'suspendido', 'inactivo', 'bloqueado'));

-- 6. Índices para sesiones y códigos ---------------------------------------
CREATE INDEX IF NOT EXISTS idx_sesiones_refresh_hash ON sesiones_usuario (refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_sesiones_familia ON sesiones_usuario (familia_token);
CREATE INDEX IF NOT EXISTS idx_codigos_hash ON codigos_verificacion (codigo_hash)
    WHERE usado = FALSE AND eliminado = FALSE;

COMMIT;
