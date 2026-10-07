-- =========================================================================
-- MIGRACIÓN 04 - CAJA (TRANSACCIONES) Y HISTORIAL FINANCIERO INMUTABLE
-- Para bases ya creadas. Una base nueva solo necesita database.sql (ya lo incluye).
-- Idempotente y en una transacción.
--
-- Reglas de dominio (docs/domain/transactions.md):
--   TRX-001  Una sola caja: no puede haber más de un turno activo a la vez.
--   TRX-005  Las entradas/salidas manuales requieren motivo.
--   TRX-008  Un turno cerrado es inmutable; las correcciones posteriores son AJUSTES auditables.
--   TRX-010  El historial financiero no se elimina ni se modifica.
-- =========================================================================

BEGIN;

-- 1. TRX-001: un único turno abierto en todo el local --------------------------------------------------------
--    Reemplaza la restricción anterior (un turno abierto por usuario). Cuando exista más de una caja física, se
--    añadirá `id_caja` y la unicidad pasará a ser por caja.
DROP INDEX IF EXISTS uq_turno_abierto_por_usuario;
CREATE UNIQUE INDEX IF NOT EXISTS uq_turno_abierto_unico
    ON turnos_caja (estado)
    WHERE estado = 'abierta' AND eliminado = FALSE;

-- 2. TRX-008: marca de ajuste sobre un turno ya cerrado ---------------------------------------------------------
ALTER TABLE transacciones_caja ADD COLUMN IF NOT EXISTS es_ajuste BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. TRX-005: los movimientos manuales y los ajustes exigen un motivo (en `notas`) --------------------------------
ALTER TABLE transacciones_caja DROP CONSTRAINT IF EXISTS ck_transacciones_motivo;
ALTER TABLE transacciones_caja ADD CONSTRAINT ck_transacciones_motivo
    CHECK (tipo_movimiento NOT IN ('ingreso_manual', 'retiro_manual', 'devolucion')
           OR char_length(btrim(coalesce(notas, ''))) >= 3);

-- 4. TRX-010: el libro de transacciones es de solo inserción ---------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_ledger_inmutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'transacciones_caja es de solo inserción: no se permite % (corrige con un ajuste auditable).', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_inmutable ON transacciones_caja;
CREATE TRIGGER trg_ledger_inmutable
    BEFORE UPDATE OR DELETE ON transacciones_caja
    FOR EACH ROW EXECUTE FUNCTION fn_ledger_inmutable();

-- 5. TRX-008: un turno cerrado no se puede modificar ni eliminar --------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_turno_cerrado_inmutable() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Los turnos de caja no se eliminan.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.estado <> 'abierta' THEN
        RAISE EXCEPTION 'Un turno de caja cerrado es inmutable (registra un ajuste auditable).' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_turno_cerrado_inmutable ON turnos_caja;
CREATE TRIGGER trg_turno_cerrado_inmutable
    BEFORE UPDATE OR DELETE ON turnos_caja
    FOR EACH ROW EXECUTE FUNCTION fn_turno_cerrado_inmutable();

-- 6. Un pedido pagado no cambia de estado ni de importes -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_pedido_pagado_inmutable() RETURNS trigger AS $$
BEGIN
    IF OLD.estado = 'pagado'
       AND (NEW.estado IS DISTINCT FROM OLD.estado
            OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
            OR NEW.descuento IS DISTINCT FROM OLD.descuento
            OR NEW.total_calculado IS DISTINCT FROM OLD.total_calculado) THEN
        RAISE EXCEPTION 'Un pedido pagado no puede cambiar de estado ni de importes.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pedido_pagado_inmutable ON pedidos;
CREATE TRIGGER trg_pedido_pagado_inmutable
    BEFORE UPDATE ON pedidos
    FOR EACH ROW EXECUTE FUNCTION fn_pedido_pagado_inmutable();

COMMIT;
