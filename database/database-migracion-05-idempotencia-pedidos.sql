-- =====================================================================================================================
-- MIGRACIÓN 05 — Idempotencia al crear pedidos + índices de concurrencia
-- Un doble clic, un reintento de red o dos terminales enviando lo mismo no deben duplicar un pedido.
-- El cliente envía la cabecera Idempotency-Key; la clave es única por usuario creador (índice parcial).
-- Se puede aplicar más de una vez (IF NOT EXISTS).
-- =====================================================================================================================
BEGIN;

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS clave_idempotencia VARCHAR(64);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS huella_solicitud   VARCHAR(64);

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS chk_pedidos_clave_idempotencia;
ALTER TABLE pedidos ADD CONSTRAINT chk_pedidos_clave_idempotencia
    CHECK (clave_idempotencia IS NULL OR (char_length(clave_idempotencia) BETWEEN 8 AND 64 AND huella_solicitud IS NOT NULL));

-- La misma clave del mismo usuario solo puede crear UN pedido: la base resuelve la carrera entre dos peticiones simultáneas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_idempotencia
    ON pedidos (usuario_creacion, clave_idempotencia)
    WHERE clave_idempotencia IS NOT NULL;

-- Consultas calientes bajo concurrencia: pedidos activos de una mesa y productos de un pedido.
CREATE INDEX IF NOT EXISTS idx_pedidos_mesa_activos
    ON pedidos (id_mesa) WHERE eliminado = FALSE AND estado IN ('pendiente', 'en_preparacion', 'listo');
CREATE INDEX IF NOT EXISTS idx_pedidos_detalle_pedido
    ON pedidos_detalle (id_pedido) WHERE eliminado = FALSE;

COMMIT;
