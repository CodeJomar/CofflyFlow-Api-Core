import { pgTable, uuid, varchar, text, timestamp, boolean, integer, numeric, jsonb } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { mesas } from './tables.schema';
import { turnos_caja } from './transactions.schema';
import { productos } from './menu.schema';
import { usuarios } from './users.schema';

export const pedidos = pgTable('pedidos', {
  id_pedido: uuid('id_pedido').primaryKey().defaultRandom(),
  id_mesa: uuid('id_mesa').references(() => mesas.id_mesa), // Nullable para takeaway o delivery
  mesa_numero: varchar('mesa_numero', { length: 10 }), // Snapshot del identificador de la mesa al crear el pedido (TAB-007)
  id_turno_caja: uuid('id_turno_caja').notNull().references(() => turnos_caja.id_turno_caja),
  correlativo: integer('correlativo').notNull().default(sql`nextval('pedidos_correlativo_seq')`), // número legible del pedido (#1, #2…)
  cliente_nombre: varchar('cliente_nombre', { length: 100 }),
  tipo_pedido: varchar('tipo_pedido', { length: 20 }).default('salon'), // 'salon', 'llevar', 'delivery'
  estado: varchar('estado', { length: 20 }).default('pendiente'), // 'pendiente', 'en_preparacion', 'listo', 'pagado', 'anulado'
  subtotal: numeric('subtotal', { precision: 10, scale: 2 }).default('0.00'),
  descuento: numeric('descuento', { precision: 10, scale: 2 }).default('0.00'),
  total_calculado: numeric('total_calculado', { precision: 10, scale: 2 }).default('0.00'),
  clave_idempotencia: varchar('clave_idempotencia', { length: 64 }), // Idempotency-Key del cliente; única por usuario creador
  huella_solicitud: varchar('huella_solicitud', { length: 64 }), // SHA-256 del contenido: detecta reutilizar la clave con otro pedido
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

export const pedidos_detalle = pgTable('pedidos_detalle', {
  id_pedido_detalle: uuid('id_pedido_detalle').primaryKey().defaultRandom(),
  id_pedido: uuid('id_pedido').notNull().references(() => pedidos.id_pedido, { onDelete: 'cascade' }),
  id_producto: uuid('id_producto').notNull().references(() => productos.id_producto),
  nombre_producto: varchar('nombre_producto', { length: 100 }).notNull(), // Snapshot histórico
  cantidad: integer('cantidad').notNull(),
  precio_unitario: numeric('precio_unitario', { precision: 10, scale: 2 }).notNull(), // Snapshot histórico
  subtotal: numeric('subtotal', { precision: 10, scale: 2 }).notNull(),
  notas_preparacion: text('notas_preparacion'),
  modificadores: jsonb('modificadores'),
  estado_kds: varchar('estado_kds', { length: 20 }).default('cola'), // 'cola', 'preparando', 'despachado'
  despachado_por: uuid('despachado_por').references(() => usuarios.id_usuario),
  despachado_el: timestamp('despachado_el', { withTimezone: true }),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

export const pedidosRelations = relations(pedidos, ({ one, many }) => ({
  mesa: one(mesas, { fields: [pedidos.id_mesa], references: [mesas.id_mesa] }),
  turno_caja: one(turnos_caja, { fields: [pedidos.id_turno_caja], references: [turnos_caja.id_turno_caja] }),
  detalles: many(pedidos_detalle),
}));

export const pedidosDetalleRelations = relations(pedidos_detalle, ({ one }) => ({
  pedido: one(pedidos, { fields: [pedidos_detalle.id_pedido], references: [pedidos.id_pedido] }),
  producto: one(productos, { fields: [pedidos_detalle.id_producto], references: [productos.id_producto] }),
  despachador: one(usuarios, { fields: [pedidos_detalle.despachado_por], references: [usuarios.id_usuario] }),
}));