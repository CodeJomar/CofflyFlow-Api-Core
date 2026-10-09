-- =========================================================================
-- COFFY FLOW - ESQUEMA DE BASE DE DATOS DEFINITIVO (PostgreSQL)
-- =========================================================================

-- Habilitar extensión para UUID v4
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================================
-- PARTE 1: SEGURIDAD, RBAC Y AUTENTICACIÓN (OWASP TOP 10)
-- =========================================================================

-- 1.1 Catálogo de Módulos del Sistema
CREATE TABLE modulos (
    id_modulo UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(50) NOT NULL,               -- 'AUTH', 'USERS', 'MENU', 'TABLES', 'ORDERS', 'KDS', 'TRANSACTIONS', 'DASHBOARD'
    descripcion TEXT,
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

-- 1.2 Catálogo de Acciones Operativas
CREATE TABLE acciones (
    id_accion UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(50) NOT NULL,               -- 'CREAR', 'LEER', 'EDITAR', 'ELIMINAR', 'COBRAR', 'DESPACHAR', 'ARQUEAR'
    descripcion TEXT,
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

-- 1.3 Cargos operativos (tabla 'roles' = Position del dominio, decisión D-003)
--     El nivel de relación con el negocio (OWNER / EMPLOYEE) vive en usuarios.tipo_cuenta.
--     Un OWNER no necesita cargo; un EMPLOYEE lleva un cargo con su matriz de permisos.
CREATE TABLE roles (
    id_rol UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(50) NOT NULL,               -- 'WAITER', 'BARISTA', 'CASHIER', 'OPERATOR'
    descripcion TEXT,
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

-- 1.4 Matriz de Permisos (RBAC Dinámico para RolesGuard)
CREATE TABLE rol_permisos (
    id_rol_permiso UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_rol UUID NOT NULL,
    id_modulo UUID NOT NULL,
    id_accion UUID NOT NULL,
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

-- 1.5 Usuarios del Sistema (Personal y Operadores)
CREATE TABLE usuarios (
    id_usuario UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_cuenta VARCHAR(10) NOT NULL DEFAULT 'EMPLOYEE', -- Account Role: 'OWNER', 'EMPLOYEE'
    id_rol UUID,                               -- Cargo operativo (NULL permitido para OWNER)
    email VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,       -- Hash bcrypt con salt rounds >= 10
    nombre VARCHAR(100) NOT NULL,
    -- 'pendiente_activacion' -> 'activo' -> 'suspendido' | 'inactivo'; 'bloqueado' = bloqueo temporal por intentos fallidos
    estado VARCHAR(25) NOT NULL DEFAULT 'pendiente_activacion',
    -- Seguridad OWASP: Verificación de identidad y bloqueo por fuerza bruta
    email_verificado BOOLEAN DEFAULT FALSE,
    email_verificado_el TIMESTAMPTZ,
    intentos_fallidos INT DEFAULT 0,
    bloqueado_hasta TIMESTAMPTZ,
    ultimo_login TIMESTAMPTZ,
    ultimo_cambio_password TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    -- Auditoría
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE,
    CONSTRAINT ck_usuarios_tipo_cuenta CHECK (tipo_cuenta IN ('OWNER', 'EMPLOYEE')),
    CONSTRAINT ck_usuarios_estado CHECK (estado IN ('pendiente_activacion', 'activo', 'suspendido', 'inactivo', 'bloqueado'))
);

-- 1.6 Códigos OTP y Tokens Temporales (Registro, Recuperación de Password y 2FA)
CREATE TABLE codigos_verificacion (
    id_codigo UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_usuario UUID NOT NULL,
    tipo VARCHAR(30) NOT NULL,                 -- 'activacion_cuenta', 'recuperacion_password' (OTP 6 dígitos), 'restablecer_password' (token tras validar OTP)
    codigo_hash VARCHAR(255) NOT NULL,        -- Tokens: SHA-256. OTP de 6 dígitos: HMAC-SHA256 con secreto del servidor. NUNCA texto plano
    expira_en TIMESTAMPTZ NOT NULL,            -- TTL corto (ej: 10 a 15 min)
    intentos INT DEFAULT 0,                    -- Mitigación de fuerza bruta sobre el código
    max_intentos INT DEFAULT 5,
    usado BOOLEAN DEFAULT FALSE,
    usado_el TIMESTAMPTZ,
    ip_solicitud VARCHAR(45),
    user_agent_solicitud TEXT,
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

-- 1.7 Sesiones Activas y Rotación de Refresh Tokens
CREATE TABLE sesiones_usuario (
    id_sesion UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_usuario UUID NOT NULL,
    refresh_token_hash VARCHAR(255) NOT NULL, -- SHA-256 del refresh token
    familia_token UUID DEFAULT gen_random_uuid(), -- Detecta reuso malicioso de tokens
    expira_en TIMESTAMPTZ NOT NULL,
    revocado BOOLEAN DEFAULT FALSE,
    revocado_el TIMESTAMPTZ,
    motivo_revocacion VARCHAR(100),            -- 'logout', 'rotacion', 'sospecha_reuso'
    ip_origen VARCHAR(45),
    user_agent TEXT,
    nombre_dispositivo VARCHAR(100),           -- Ej: 'Tablet POS Salón 1'
    ultimo_uso TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

-- 1.8 Log Inmutable de Auditoría de Seguridad (OWASP A09)
CREATE TABLE auditoria_seguridad (
    id_auditoria UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_usuario UUID,                           -- Puede ser NULL si el intento usó un email inexistente
    evento VARCHAR(50) NOT NULL,               -- 'LOGIN_OK', 'LOGIN_FALLIDO', 'OTP_SOLICITADO', 'OTP_FALLIDO', 'PASSWORD_RESET', 'CUENTA_ACTIVADA', 'LOGOUT', 'REFRESH_REUSO', 'ACCESO_DENEGADO'
    nivel_severidad VARCHAR(20) DEFAULT 'INFO',-- 'INFO', 'WARN', 'CRITICAL'
    ip VARCHAR(45),
    user_agent TEXT,
    detalles JSONB,                            -- Información contextual sin datos sensibles
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================================
-- PARTE 2: OPERACIÓN DE SALÓN, MENÚ Y STOCK TÁCTIL
-- =========================================================================

-- 2.1 Categorías del Catálogo
CREATE TABLE categorias (
    id_categoria UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(50) NOT NULL,               -- 'Bebidas Calientes', 'Bebidas Frías', 'Pastelería', 'Sandwiches'
    descripcion TEXT,
    orden_visual INT DEFAULT 0,
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

-- 2.2 Productos del Menú y Disponibilidad Rápida (HU-02)
CREATE TABLE productos (
    id_producto UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_categoria UUID NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    precio NUMERIC(10, 2) NOT NULL,
    disponible BOOLEAN DEFAULT TRUE,           -- Interruptor táctil de stock en POS
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

-- 2.3 Mesas del Salón (Máquina de Estados de Concurrencia Física)
CREATE TABLE mesas (
    id_mesa UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero VARCHAR(10) NOT NULL,               -- 'M1', 'M2', 'Barra 1', 'Terraza 3'
    capacidad INT DEFAULT 2,
    estado VARCHAR(20) DEFAULT 'libre',        -- 'libre', 'ocupada', 'por_cobrar'
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

-- =========================================================================
-- PARTE 3: CAJA, PEDIDOS (ACID) Y KDS EN TIEMPO REAL
-- =========================================================================

-- 3.1 Turnos de Caja (Aperturas, Arqueos y Cierres)
CREATE TABLE turnos_caja (
    id_turno_caja UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_usuario_apertura UUID NOT NULL,
    id_usuario_cierre UUID,
    fecha_apertura TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre TIMESTAMPTZ,
    monto_inicial NUMERIC(10, 2) NOT NULL,
    monto_final_calculado NUMERIC(10, 2) DEFAULT 0.00,
    monto_final_real NUMERIC(10, 2),
    diferencia NUMERIC(10, 2) DEFAULT 0.00,    -- Descuadre de caja (real - calculado)
    estado VARCHAR(20) DEFAULT 'abierta',      -- 'abierta', 'cerrada', 'descuadre'
    notas_cierre TEXT,
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

-- 3.2 Pedidos / Comandas (Cabecera Transaccional ACID)
CREATE TABLE pedidos (
    id_pedido UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_mesa UUID,                              -- NULL para pedidos 'llevar' o 'delivery'
    id_turno_caja UUID NOT NULL,
    tipo_pedido VARCHAR(20) DEFAULT 'salon',   -- 'salon', 'llevar', 'delivery'
    estado VARCHAR(20) DEFAULT 'pendiente',    -- 'pendiente', 'en_preparacion', 'listo', 'pagado', 'anulado'
    subtotal NUMERIC(10, 2) DEFAULT 0.00,
    descuento NUMERIC(10, 2) DEFAULT 0.00,
    total_calculado NUMERIC(10, 2) DEFAULT 0.00,
    usuario_creacion UUID,                     -- Mozo o Cajero que abrió la comanda
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

-- 3.3 Detalle de Pedidos (Snapshot Histórico y Monitor de Cocina KDS)
CREATE TABLE pedidos_detalle (
    id_pedido_detalle UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_pedido UUID NOT NULL,
    id_producto UUID NOT NULL,
    nombre_producto VARCHAR(100) NOT NULL,    -- Snapshot: nombre al momento de pedir
    cantidad INT NOT NULL,
    precio_unitario NUMERIC(10, 2) NOT NULL,  -- Snapshot: precio unitario histórico
    subtotal NUMERIC(10, 2) NOT NULL,
    notas_preparacion TEXT,                    -- Instrucciones especiales (anti-XSS sanitizado)
    modificadores JSONB,                      -- Opciones extra (ej: leche deslactosada, jarabe)
    estado_kds VARCHAR(20) DEFAULT 'cola',     -- 'cola', 'preparando', 'despachado'
    despachado_por UUID,                       -- Barista o Cocinero que despachó
    despachado_el TIMESTAMPTZ,
    usuario_creacion UUID,
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

-- 3.4 Transacciones de Caja (Ledger Inmutable / Append-Only)
CREATE TABLE transacciones_caja (
    id_transaccion_caja UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_turno_caja UUID NOT NULL,
    id_pedido UUID,                            -- NULL si es ingreso o retiro administrativo
    tipo_movimiento VARCHAR(20) NOT NULL,      -- 'venta', 'ingreso_manual', 'retiro_manual', 'devolucion'
    metodo_pago VARCHAR(20) NOT NULL,          -- 'efectivo', 'tarjeta', 'yape', 'plin', 'transferencia'
    monto NUMERIC(10, 2) NOT NULL,
    notas TEXT,
    usuario_creacion UUID,                     -- Cajero responsable del movimiento
    usuario_edicion UUID,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_edicion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    eliminado BOOLEAN DEFAULT FALSE
);

-- =========================================================================
-- PARTE 4: RELACIONES Y RESTRICCIONES (FOREIGN KEYS)
-- =========================================================================

-- RBAC y Usuarios
ALTER TABLE usuarios ADD CONSTRAINT fk_usuarios_rol 
    FOREIGN KEY (id_rol) REFERENCES roles(id_rol);

ALTER TABLE rol_permisos ADD CONSTRAINT fk_rp_rol 
    FOREIGN KEY (id_rol) REFERENCES roles(id_rol) ON DELETE CASCADE;

ALTER TABLE rol_permisos ADD CONSTRAINT fk_rp_modulo 
    FOREIGN KEY (id_modulo) REFERENCES modulos(id_modulo) ON DELETE CASCADE;

ALTER TABLE rol_permisos ADD CONSTRAINT fk_rp_accion 
    FOREIGN KEY (id_accion) REFERENCES acciones(id_accion) ON DELETE CASCADE;

-- Sesiones y Seguridad
ALTER TABLE codigos_verificacion ADD CONSTRAINT fk_codigos_usuario 
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE;

ALTER TABLE sesiones_usuario ADD CONSTRAINT fk_sesiones_usuario 
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE;

-- Catálogo
ALTER TABLE productos ADD CONSTRAINT fk_productos_categoria 
    FOREIGN KEY (id_categoria) REFERENCES categorias(id_categoria);

-- Turnos y Pedidos
ALTER TABLE turnos_caja ADD CONSTRAINT fk_turno_usuario_apertura 
    FOREIGN KEY (id_usuario_apertura) REFERENCES usuarios(id_usuario);

ALTER TABLE turnos_caja ADD CONSTRAINT fk_turno_usuario_cierre 
    FOREIGN KEY (id_usuario_cierre) REFERENCES usuarios(id_usuario);

ALTER TABLE pedidos ADD CONSTRAINT fk_pedidos_mesa 
    FOREIGN KEY (id_mesa) REFERENCES mesas(id_mesa);

ALTER TABLE pedidos ADD CONSTRAINT fk_pedidos_turno_caja 
    FOREIGN KEY (id_turno_caja) REFERENCES turnos_caja(id_turno_caja);

-- Detalles y KDS
ALTER TABLE pedidos_detalle ADD CONSTRAINT fk_detalles_pedido 
    FOREIGN KEY (id_pedido) REFERENCES pedidos(id_pedido) ON DELETE CASCADE;

ALTER TABLE pedidos_detalle ADD CONSTRAINT fk_detalles_producto 
    FOREIGN KEY (id_producto) REFERENCES productos(id_producto);

ALTER TABLE pedidos_detalle ADD CONSTRAINT fk_detalles_despachador 
    FOREIGN KEY (despachado_por) REFERENCES usuarios(id_usuario);

-- Transacciones Financieras
ALTER TABLE transacciones_caja ADD CONSTRAINT fk_tx_turno 
    FOREIGN KEY (id_turno_caja) REFERENCES turnos_caja(id_turno_caja);

ALTER TABLE transacciones_caja ADD CONSTRAINT fk_tx_pedido 
    FOREIGN KEY (id_pedido) REFERENCES pedidos(id_pedido);

-- =========================================================================
-- PARTE 5: ÍNDICES CONDICIONALES (SOFT-DELETE) Y ALTO RENDIMIENTO
-- =========================================================================

-- 5.1 Unicidad Lógica (Permite recrear registros si el original fue eliminado lógicamente)
CREATE UNIQUE INDEX uq_modulos_nombre ON modulos(nombre) WHERE eliminado = FALSE;
CREATE UNIQUE INDEX uq_acciones_nombre ON acciones(nombre) WHERE eliminado = FALSE;
CREATE UNIQUE INDEX uq_roles_nombre ON roles(nombre) WHERE eliminado = FALSE;
CREATE UNIQUE INDEX uq_usuarios_email ON usuarios(email) WHERE eliminado = FALSE;
CREATE UNIQUE INDEX uq_mesas_numero ON mesas(numero) WHERE eliminado = FALSE;
CREATE UNIQUE INDEX uq_rol_permiso ON rol_permisos(id_rol, id_modulo, id_accion) WHERE eliminado = FALSE;

-- 5.2 Autenticación y Sesiones
CREATE UNIQUE INDEX uq_sesiones_refresh_token ON sesiones_usuario (refresh_token_hash) 
    WHERE revocado = FALSE AND eliminado = FALSE;
CREATE INDEX idx_sesiones_refresh_hash ON sesiones_usuario (refresh_token_hash); -- Detección de reuso (tokens ya revocados)
CREATE INDEX idx_sesiones_familia ON sesiones_usuario (familia_token);
CREATE INDEX idx_sesiones_usuario_activas ON sesiones_usuario (id_usuario) 
    WHERE revocado = FALSE AND eliminado = FALSE;
CREATE INDEX idx_codigos_hash ON codigos_verificacion (codigo_hash)
    WHERE usado = FALSE AND eliminado = FALSE;
CREATE INDEX idx_codigos_usuario_tipo ON codigos_verificacion (id_usuario, tipo) 
    WHERE usado = FALSE AND eliminado = FALSE;

-- 5.3 KDS en Tiempo Real (Pantallas de Cocina y Barra)
-- Filtrado instantáneo para pedidos activos en preparación
CREATE INDEX idx_kds_pendientes ON pedidos_detalle (estado_kds, fecha_creacion) 
    WHERE estado_kds IN ('cola', 'preparando') AND eliminado = FALSE;
CREATE INDEX idx_detalles_pedido_fk ON pedidos_detalle (id_pedido) 
    WHERE eliminado = FALSE;

-- 5.4 POS Salón y Control de Concurrencia de Mesas
CREATE INDEX idx_mesas_estado ON mesas (estado) 
    WHERE eliminado = FALSE;
CREATE INDEX idx_productos_categoria_disp ON productos (id_categoria, disponible) 
    WHERE eliminado = FALSE;

-- 5.5 Cierres de Turno y Consultas Pesadas del Dashboard (Recharts)
CREATE INDEX idx_pedidos_turno_estado ON pedidos (id_turno_caja, estado) 
    WHERE eliminado = FALSE;
CREATE INDEX idx_tx_turno ON transacciones_caja (id_turno_caja, tipo_movimiento) 
    WHERE eliminado = FALSE;
CREATE INDEX idx_pedidos_fecha ON pedidos (fecha_creacion DESC) 
    WHERE eliminado = FALSE;
CREATE INDEX idx_tx_fecha ON transacciones_caja (fecha_creacion DESC) 
    WHERE eliminado = FALSE;

-- 5.6 Trazabilidad y Log de Seguridad
CREATE INDEX idx_auditoria_usuario ON auditoria_seguridad (id_usuario);
CREATE INDEX idx_auditoria_evento ON auditoria_seguridad (evento);
CREATE INDEX idx_auditoria_fecha ON auditoria_seguridad (fecha_creacion DESC);

-- =========================================================================
-- PARTE 6: SEGURIDAD E INTEGRIDAD A NIVEL DE BASE DE DATOS (última línea de defensa)
-- (la API ya lo valida; se repite aquí por si un bug o un acceso directo intentara dejar datos inconsistentes)
-- =========================================================================

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

-- =========================================================================
-- PARTE 7: MENÚ (MODIFICADORES) Y MESAS (áreas, snapshot de mesa en pedidos)
-- =========================================================================

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

-- =========================================================================
-- PARTE 8: CAJA (una sola caja activa) E HISTORIAL FINANCIERO INMUTABLE
-- =========================================================================

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

-- ===== Parte 9: idempotencia de pedidos (database-migracion-05-idempotencia-pedidos.sql) =====
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

-- ===== Parte 10: pagos mixtos, parciales y devoluciones (database-migracion-06-pagos-devoluciones.sql) =====
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

-- ===== Parte 11: brechas detectadas al integrar la web (database-migracion-07-brechas-web.sql) =====
-- 1. Turnos de caja ---------------------------------------------------------------------------------------------------
ALTER TABLE turnos_caja ADD COLUMN IF NOT EXISTS nota_apertura  VARCHAR(255);
ALTER TABLE turnos_caja ADD COLUMN IF NOT EXISTS conteo_cierre  JSONB; -- { "b200": 1, "m050": 3, ... } cantidad contada por denominación

-- 2. Pedidos -----------------------------------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS pedidos_correlativo_seq START 1;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS correlativo     INTEGER NOT NULL DEFAULT nextval('pedidos_correlativo_seq');
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cliente_nombre  VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedidos_correlativo ON pedidos (correlativo);

-- 3. Usuarios (ficha del empleado) ---------------------------------------------------------------------------------------
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS dni            VARCHAR(255);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefono       VARCHAR(255);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS fecha_ingreso  DATE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS fecha_baja     TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS motivo_baja    VARCHAR(255);

-- 4. Productos ---------------------------------------------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen_url    VARCHAR(500);
