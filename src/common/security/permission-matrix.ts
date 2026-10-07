/**
 * Matriz de permisos por cargo: FUENTE ÚNICA. La usan el seed (`npm run seed:permisos`) y los decoradores
 * `@RequirePermission(MODULO.X, ACCION.Y)` de los controladores.
 *
 * Modelo (decisión D-003): OWNER (tipo_cuenta) tiene acceso total y no necesita cargo. Cada EMPLOYEE lleva un
 * cargo y solo puede lo que esta matriz le concede. La matriz vive en la base (`rol_permisos`) y puede
 * ajustarse sin desplegar; este archivo define los valores iniciales.
 */

export const MODULO = {
  USERS: 'USERS',
  ROLES: 'ROLES',
  MENU: 'MENU',
  TABLES: 'TABLES',
  ORDERS: 'ORDERS',
  KDS: 'KDS',
  TRANSACTIONS: 'TRANSACTIONS',
  DASHBOARD: 'DASHBOARD',
} as const;

export const ACCION = {
  LEER: 'LEER',
  CREAR: 'CREAR',
  EDITAR: 'EDITAR',
  ELIMINAR: 'ELIMINAR',
  COBRAR: 'COBRAR',
  DESPACHAR: 'DESPACHAR',
  ARQUEAR: 'ARQUEAR',
  /** Marcar un producto como disponible / agotado (acción táctil rápida). */
  DISPONIBILIDAD: 'DISPONIBILIDAD',
  /** Registrar un ajuste auditable sobre un turno de caja ya cerrado (por defecto solo OWNER). */
  AJUSTAR: 'AJUSTAR',
  /** Aplicar descuentos a un pedido (por defecto solo OWNER: un mozo no puede regalar productos). */
  DESCONTAR: 'DESCONTAR',
  /** Anular un pedido (por defecto OWNER y cajero). Exige motivo y queda auditado. */
  ANULAR: 'ANULAR',
  /** Devolver (total o parcialmente) un cobro. Por defecto solo OWNER: es salida de dinero. */
  DEVOLVER: 'DEVOLVER',
  /** Cambiar el estado operativo de una mesa (ocupada, por cobrar, por limpiar, libre). */
  CAMBIAR_ESTADO: 'CAMBIAR_ESTADO',
} as const;

/** Nombres para mostrar en la interfaz (si un módulo o acción no aparece aquí, se muestra su código). */
export const ETIQUETA_MODULO: Record<string, string> = {
  USERS: 'Personal',
  ROLES: 'Roles y permisos',
  MENU: 'Menú',
  TABLES: 'Mesas',
  ORDERS: 'Pedidos',
  KDS: 'Cocina y barra (KDS)',
  TRANSACTIONS: 'Caja y cobros',
  DASHBOARD: 'Dashboard',
};

export const ETIQUETA_ACCION: Record<string, string> = {
  LEER: 'Ver',
  CREAR: 'Crear',
  EDITAR: 'Editar',
  ELIMINAR: 'Eliminar',
  COBRAR: 'Cobrar',
  DESPACHAR: 'Despachar',
  ARQUEAR: 'Abrir y cerrar caja',
  DISPONIBILIDAD: 'Marcar disponible o agotado',
  DESCONTAR: 'Aplicar descuentos',
  ANULAR: 'Anular pedidos',
  DEVOLVER: 'Devolver cobros',
  AJUSTAR: 'Ajustar turnos cerrados',
  CAMBIAR_ESTADO: 'Cambiar estado',
};

/**
 * Permisos que NO se exigen con un decorador en un endpoint sino dentro de un servicio (porque dependen de los datos
 * de la petición). El descubrimiento automático no los ve, así que se declaran aquí para que aparezcan en el catálogo
 * y se puedan conceder desde la administración de roles.
 */
export const PERMISOS_DE_SERVICIO: ReadonlyArray<{ modulo: string; accion: string; descripcion: string }> = [
  { modulo: 'ORDERS', accion: 'DESCONTAR', descripcion: 'Aplicar un descuento al crear un pedido (regla de negocio, no es un endpoint).' },
  { modulo: 'ORDERS', accion: 'ANULAR', descripcion: 'Anular un pedido (exige motivo y queda auditado).' },
];

export type Modulo = (typeof MODULO)[keyof typeof MODULO];
export type Accion = (typeof ACCION)[keyof typeof ACCION];
export type Permiso = readonly [Modulo, Accion];

export const CARGO = {
  WAITER: 'WAITER',
  BARISTA: 'BARISTA',
  CASHIER: 'CASHIER',
  OPERATOR: 'OPERATOR',
} as const;

const { MENU, TABLES, ORDERS, KDS, TRANSACTIONS } = MODULO;
const { LEER, CREAR, EDITAR, COBRAR, DESPACHAR, ARQUEAR, DISPONIBILIDAD, CAMBIAR_ESTADO, ANULAR } = ACCION;

export const PERMISOS_POR_CARGO: Record<keyof typeof CARGO, readonly Permiso[]> = {
  // Toma pedidos en el POS y atiende el salón.
  WAITER: [
    [MENU, LEER], [MENU, DISPONIBILIDAD],
    [TABLES, LEER], [TABLES, CAMBIAR_ESTADO],
    [ORDERS, LEER], [ORDERS, CREAR], [ORDERS, EDITAR],
  ],
  // Prepara y despacha en el KDS.
  BARISTA: [
    [MENU, LEER], [MENU, DISPONIBILIDAD],
    [TABLES, LEER], [TABLES, CAMBIAR_ESTADO],
    [ORDERS, LEER],
    [KDS, LEER], [KDS, DESPACHAR],
  ],
  // POS, cobro y gestión de caja.
  CASHIER: [
    [MENU, LEER], [MENU, DISPONIBILIDAD],
    [TABLES, LEER], [TABLES, CAMBIAR_ESTADO],
    [ORDERS, LEER], [ORDERS, CREAR], [ORDERS, EDITAR], [ORDERS, ANULAR],
    [TRANSACTIONS, LEER], [TRANSACTIONS, CREAR], [TRANSACTIONS, COBRAR], [TRANSACTIONS, ARQUEAR],
  ],
  // Disponibilidad de menú y consultas operativas.
  OPERATOR: [
    [MENU, LEER], [MENU, DISPONIBILIDAD],
    [TABLES, LEER],
    [ORDERS, LEER],
    [KDS, LEER],
  ],
};
