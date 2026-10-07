-- =========================================================================
-- MIGRACIÓN 03 - MENÚ (MODIFICADORES) Y MESAS
-- Para bases ya creadas. Una base nueva solo necesita database.sql (ya lo incluye).
-- Es idempotente y va en una transacción: si algo falla, no se aplica nada.
--
-- Reglas de dominio que habilita (docs/domain/menu.md y tables.md):
--   MENU-003..006  Producto + grupos de modificadores + opciones, con selección mínima/máxima y precio +/-.
--   TAB-003        Las mesas pertenecen a un área (salón, terraza, barra...).
--   TAB-007        El pedido conserva el identificador de la mesa tal como era al crearlo (snapshot).
-- =========================================================================

BEGIN;

-- 1. Mesas: área ---------------------------------------------------------------------------------------------
ALTER TABLE mesas ADD COLUMN IF NOT EXISTS area VARCHAR(30);

-- 2. Pedidos: snapshot del identificador de mesa --------------------------------------------------------------
--    Si luego se renombra la mesa, el historial sigue mostrando el nombre que tenía cuando se tomó el pedido.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS mesa_numero VARCHAR(10);
UPDATE pedidos p
   SET mesa_numero = m.numero
  FROM mesas m
 WHERE p.id_mesa = m.id_mesa AND p.mesa_numero IS NULL;

-- 3. Unicidad de nombres en el catálogo (sin distinguir mayúsculas, ignorando lo eliminado) --------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_categorias_nombre
    ON categorias (lower(nombre)) WHERE eliminado = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_productos_categoria_nombre
    ON productos (id_categoria, lower(nombre)) WHERE eliminado = FALSE;

-- 4. Modificadores -----------------------------------------------------------------------------------------------
-- 4.1 Grupos de modificadores (p. ej. "Tipo de leche", "Tamaño"). Un grupo con seleccion_minima >= 1 es obligatorio.
CREATE TABLE IF NOT EXISTS grupos_modificadores (
    id_grupo UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(60) NOT NULL,
    descripcion TEXT,
    seleccion_minima INT NOT NULL DEFAULT 0,   -- 0 = opcional; >= 1 = obligatorio
    seleccion_maxima INT NOT NULL DEFAULT 1,
    orden_visual INT DEFAULT 0,
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE,
    CONSTRAINT ck_grupos_seleccion CHECK (seleccion_minima >= 0 AND seleccion_maxima >= 1 AND seleccion_maxima >= seleccion_minima)
);

-- 4.2 Opciones seleccionables dentro de un grupo (p. ej. "Avena +2.00"). price_delta puede ser negativo.
CREATE TABLE IF NOT EXISTS opciones_modificador (
    id_opcion UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_grupo UUID NOT NULL REFERENCES grupos_modificadores(id_grupo),
    nombre VARCHAR(60) NOT NULL,
    price_delta NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    disponible BOOLEAN DEFAULT TRUE,           -- Una opción agotada no se puede elegir en pedidos nuevos
    orden_visual INT DEFAULT 0,
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE,
    CONSTRAINT ck_opciones_delta CHECK (price_delta BETWEEN -9999.99 AND 9999.99)
);

-- 4.3 Qué grupos aplican a cada producto (un producto puede tener cero o más grupos).
CREATE TABLE IF NOT EXISTS productos_grupos_modificadores (
    id_producto_grupo UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_producto UUID NOT NULL REFERENCES productos(id_producto),
    id_grupo UUID NOT NULL REFERENCES grupos_modificadores(id_grupo),
    orden_visual INT DEFAULT 0,
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_grupos_modificadores_nombre
    ON grupos_modificadores (lower(nombre)) WHERE eliminado = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_opciones_grupo_nombre
    ON opciones_modificador (id_grupo, lower(nombre)) WHERE eliminado = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_producto_grupo
    ON productos_grupos_modificadores (id_producto, id_grupo) WHERE eliminado = FALSE;
CREATE INDEX IF NOT EXISTS idx_opciones_grupo
    ON opciones_modificador (id_grupo) WHERE eliminado = FALSE;
CREATE INDEX IF NOT EXISTS idx_pgm_producto
    ON productos_grupos_modificadores (id_producto) WHERE eliminado = FALSE;

COMMIT;
