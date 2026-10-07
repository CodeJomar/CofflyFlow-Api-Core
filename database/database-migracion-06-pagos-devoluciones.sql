-- =====================================================================================================================
-- MIGRACIÓN 06 — Pagos mixtos, pagos parciales (cada comensal paga su parte) y devoluciones
--  * Un pedido admite VARIOS cobros (distintos métodos y/o distintas personas) hasta cubrir su total.
--  * Cada cobro y cada devolución lleva una Idempotency-Key: un doble clic nunca cobra ni devuelve dos veces.
--  * Una devolución enlaza con el cobro que revierte (id_transaccion_origen) y nunca supera lo cobrado.
--  * La base garantiza los topes aunque falle la aplicación (triggers con bloqueo de fila).
-- Se puede aplicar más de una vez.
-- =====================================================================================================================
BEGIN;

-- 1. Antes había exactamente una venta por pedido; ahora son varias (los topes los fija el trigger de abajo) ----------
DROP INDEX IF EXISTS uq_venta_por_pedido;

-- 2. Columnas nuevas en el libro de caja --------------------------------------------------------------------------------
ALTER TABLE transacciones_caja ADD COLUMN IF NOT EXISTS id_transaccion_origen UUID REFERENCES transacciones_caja(id_transaccion_caja);
ALTER TABLE transacciones_caja ADD COLUMN IF NOT EXISTS clave_idempotencia    VARCHAR(80);

-- La misma clave del mismo usuario solo puede registrar UNA vez cada línea (se usa "<clave>#<n>" por línea de pago).
CREATE UNIQUE INDEX IF NOT EXISTS uq_transaccion_idempotencia
    ON transacciones_caja (usuario_creacion, clave_idempotencia)
    WHERE clave_idempotencia IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transacciones_pedido
    ON transacciones_caja (id_pedido) WHERE id_pedido IS NOT NULL AND eliminado = FALSE;
CREATE INDEX IF NOT EXISTS idx_transacciones_origen
    ON transacciones_caja (id_transaccion_origen) WHERE id_transaccion_origen IS NOT NULL;

-- 3. Una devolución (no ajuste) siempre apunta a una venta y a su pedido ---------------------------------------------------
ALTER TABLE transacciones_caja DROP CONSTRAINT IF EXISTS ck_devolucion_origen;
ALTER TABLE transacciones_caja ADD CONSTRAINT ck_devolucion_origen
    CHECK (tipo_movimiento <> 'devolucion' OR es_ajuste OR (id_transaccion_origen IS NOT NULL AND id_pedido IS NOT NULL));

-- 4. Topes de cobro y de devolución, garantizados por la base ----------------------------------------------------------------
--    Se bloquea la fila padre (pedido o venta de origen) para serializar cobros/devoluciones simultáneos.
CREATE OR REPLACE FUNCTION fn_transaccion_topes() RETURNS trigger AS $$
DECLARE
    v_total    NUMERIC(10,2);
    v_pagado   NUMERIC(10,2);
    v_orig     RECORD;
    v_devuelto NUMERIC(10,2);
BEGIN
    IF NEW.es_ajuste THEN
        RETURN NEW;
    END IF;

    IF NEW.tipo_movimiento = 'venta' AND NEW.id_pedido IS NOT NULL THEN
        SELECT total_calculado INTO v_total FROM pedidos WHERE id_pedido = NEW.id_pedido FOR UPDATE;
        SELECT COALESCE(SUM(monto), 0) INTO v_pagado
          FROM transacciones_caja
         WHERE id_pedido = NEW.id_pedido AND tipo_movimiento = 'venta' AND eliminado = FALSE;
        IF v_pagado + NEW.monto > v_total THEN
            RAISE EXCEPTION 'El cobro supera el saldo pendiente del pedido.' USING ERRCODE = 'check_violation';
        END IF;

    ELSIF NEW.tipo_movimiento = 'devolucion' AND NEW.id_transaccion_origen IS NOT NULL THEN
        SELECT id_transaccion_caja, id_pedido, tipo_movimiento, metodo_pago, monto INTO v_orig
          FROM transacciones_caja WHERE id_transaccion_caja = NEW.id_transaccion_origen FOR UPDATE;
        IF NOT FOUND OR v_orig.tipo_movimiento <> 'venta' THEN
            RAISE EXCEPTION 'La devolución debe referir a un cobro (venta).' USING ERRCODE = 'check_violation';
        END IF;
        IF v_orig.id_pedido IS DISTINCT FROM NEW.id_pedido OR v_orig.metodo_pago <> NEW.metodo_pago THEN
            RAISE EXCEPTION 'La devolución debe ser del mismo pedido y método de pago que el cobro.' USING ERRCODE = 'check_violation';
        END IF;
        SELECT COALESCE(SUM(monto), 0) INTO v_devuelto
          FROM transacciones_caja
         WHERE id_transaccion_origen = NEW.id_transaccion_origen AND tipo_movimiento = 'devolucion' AND eliminado = FALSE;
        IF v_devuelto + NEW.monto > v_orig.monto THEN
            RAISE EXCEPTION 'La devolución supera lo cobrado en esa transacción.' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transaccion_topes ON transacciones_caja;
CREATE TRIGGER trg_transaccion_topes
    BEFORE INSERT ON transacciones_caja
    FOR EACH ROW EXECUTE FUNCTION fn_transaccion_topes();

COMMIT;
