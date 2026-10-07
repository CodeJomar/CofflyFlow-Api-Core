-- =========================================================================
-- MIGRACIÓN 02 - SEGURIDAD E INTEGRIDAD A NIVEL DE BASE DE DATOS
-- Para bases ya creadas. Una base nueva solo necesita database.sql (ya lo incluye).
-- Es idempotente: se puede ejecutar más de una vez. Ejecutar en una transacción y revisar antes de COMMIT.
--
-- La API ya valida todo esto; aquí se repite como ÚLTIMA línea de defensa, por si un bug, un script manual o
-- una consulta directa intentara dejar datos inconsistentes.
-- =========================================================================

BEGIN;

-- 1. Auditoría de seguridad INMUTABLE (append-only) ------------------------------------------------------
--    Nadie (ni un bug de la API, ni un acceso con las credenciales de la aplicación) puede alterar o borrar
--    el rastro de lo ocurrido. Solo se permiten INSERT.
CREATE OR REPLACE FUNCTION fn_auditoria_inmutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'auditoria_seguridad es append-only: no se permite % sobre esta tabla.', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditoria_inmutable ON auditoria_seguridad;
CREATE TRIGGER trg_auditoria_inmutable
    BEFORE UPDATE OR DELETE ON auditoria_seguridad
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria_inmutable();

DROP TRIGGER IF EXISTS trg_auditoria_sin_truncate ON auditoria_seguridad;
CREATE TRIGGER trg_auditoria_sin_truncate
    BEFORE TRUNCATE ON auditoria_seguridad
    FOR EACH STATEMENT EXECUTE FUNCTION fn_auditoria_inmutable();

-- 2. Unicidad que evita fraude y dobles operaciones ---------------------------------------------------
--    Un pedido se cobra una sola vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_venta_por_pedido
    ON transacciones_caja (id_pedido)
    WHERE tipo_movimiento = 'venta' AND eliminado = FALSE;

--    Un usuario no puede tener dos turnos de caja abiertos a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_turno_abierto_por_usuario
    ON turnos_caja (id_usuario_apertura)
    WHERE estado = 'abierta' AND eliminado = FALSE;

-- 3. Importes y cantidades válidos -----------------------------------------------------------------------
ALTER TABLE productos DROP CONSTRAINT IF EXISTS ck_productos_precio;
ALTER TABLE productos ADD CONSTRAINT ck_productos_precio CHECK (precio >= 0);

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS ck_pedidos_importes;
ALTER TABLE pedidos ADD CONSTRAINT ck_pedidos_importes
    CHECK (subtotal >= 0 AND descuento >= 0 AND descuento <= subtotal AND total_calculado >= 0);

ALTER TABLE pedidos_detalle DROP CONSTRAINT IF EXISTS ck_pedidos_detalle_importes;
ALTER TABLE pedidos_detalle ADD CONSTRAINT ck_pedidos_detalle_importes
    CHECK (cantidad > 0 AND precio_unitario >= 0 AND subtotal >= 0);

ALTER TABLE transacciones_caja DROP CONSTRAINT IF EXISTS ck_transacciones_monto;
ALTER TABLE transacciones_caja ADD CONSTRAINT ck_transacciones_monto CHECK (monto > 0);

ALTER TABLE turnos_caja DROP CONSTRAINT IF EXISTS ck_turnos_montos;
ALTER TABLE turnos_caja ADD CONSTRAINT ck_turnos_montos
    CHECK (monto_inicial >= 0 AND (monto_final_real IS NULL OR monto_final_real >= 0));

ALTER TABLE mesas DROP CONSTRAINT IF EXISTS ck_mesas_capacidad;
ALTER TABLE mesas ADD CONSTRAINT ck_mesas_capacidad CHECK (capacidad > 0);

-- 4. Estados y catálogos válidos ------------------------------------------------------------------------
ALTER TABLE mesas DROP CONSTRAINT IF EXISTS ck_mesas_estado;
ALTER TABLE mesas ADD CONSTRAINT ck_mesas_estado
    CHECK (estado IN ('libre', 'ocupada', 'por_cobrar', 'por_limpiar'));

ALTER TABLE turnos_caja DROP CONSTRAINT IF EXISTS ck_turnos_estado;
ALTER TABLE turnos_caja ADD CONSTRAINT ck_turnos_estado CHECK (estado IN ('abierta', 'cerrada', 'descuadre'));

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS ck_pedidos_estado;
ALTER TABLE pedidos ADD CONSTRAINT ck_pedidos_estado
    CHECK (estado IN ('pendiente', 'en_preparacion', 'listo', 'pagado', 'anulado'));

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS ck_pedidos_tipo;
ALTER TABLE pedidos ADD CONSTRAINT ck_pedidos_tipo CHECK (tipo_pedido IN ('salon', 'llevar', 'delivery'));

ALTER TABLE pedidos_detalle DROP CONSTRAINT IF EXISTS ck_pedidos_detalle_estado_kds;
ALTER TABLE pedidos_detalle ADD CONSTRAINT ck_pedidos_detalle_estado_kds
    CHECK (estado_kds IN ('cola', 'preparando', 'despachado'));

ALTER TABLE transacciones_caja DROP CONSTRAINT IF EXISTS ck_transacciones_tipo;
ALTER TABLE transacciones_caja ADD CONSTRAINT ck_transacciones_tipo
    CHECK (tipo_movimiento IN ('venta', 'ingreso_manual', 'retiro_manual', 'devolucion'));

ALTER TABLE transacciones_caja DROP CONSTRAINT IF EXISTS ck_transacciones_metodo;
ALTER TABLE transacciones_caja ADD CONSTRAINT ck_transacciones_metodo
    CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'yape', 'plin', 'transferencia'));

COMMIT;
