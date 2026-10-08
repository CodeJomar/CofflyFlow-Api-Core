-- =====================================================================================================================
-- MIGRACIÓN 07 — Brechas detectadas al integrar la web
--  * Turno de caja: nota de apertura y conteo por denominación guardado en el cierre (arqueo auditable).
--  * Pedido: correlativo propio legible (#1, #2…) y nombre del cliente.
--  * Empleado: DNI, teléfono, fecha de ingreso, fecha y motivo de baja.
--  * Producto: URL de imagen.
-- Solo agrega columnas e índices (no borra ni modifica datos). Se puede aplicar más de una vez.
-- =====================================================================================================================
BEGIN;

-- 1. Turnos de caja ---------------------------------------------------------------------------------------------------
ALTER TABLE turnos_caja ADD COLUMN IF NOT EXISTS nota_apertura  VARCHAR(255);
ALTER TABLE turnos_caja ADD COLUMN IF NOT EXISTS conteo_cierre  JSONB; -- { "b200": 1, "m050": 3, ... } cantidad contada por denominación

-- 2. Pedidos -----------------------------------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS pedidos_correlativo_seq START 1;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS correlativo     INTEGER NOT NULL DEFAULT nextval('pedidos_correlativo_seq');
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cliente_nombre  VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_correlativo ON pedidos (correlativo);

-- 3. Usuarios (ficha del empleado) ---------------------------------------------------------------------------------------
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS dni            VARCHAR(15);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefono       VARCHAR(20);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS fecha_ingreso  DATE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS fecha_baja     TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS motivo_baja    VARCHAR(255);

-- 4. Productos ---------------------------------------------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen_url    VARCHAR(500);

COMMIT;
