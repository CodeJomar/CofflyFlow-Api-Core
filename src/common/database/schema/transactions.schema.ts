import { pgTable, uuid, varchar, text, timestamp, boolean, numeric } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { usuarios } from './users.schema';
import { pedidos } from './orders.schema';

export const turnos_caja = pgTable('turnos_caja', {
  id_turno_caja: uuid('id_turno_caja').primaryKey().defaultRandom(),
  id_usuario_apertura: uuid('id_usuario_apertura').notNull().references(() => usuarios.id_usuario),
  id_usuario_cierre: uuid('id_usuario_cierre').references(() => usuarios.id_usuario),
  fecha_apertura: timestamp('fecha_apertura', { withTimezone: true }).defaultNow(),
  fecha_cierre: timestamp('fecha_cierre', { withTimezone: true }),
  monto_inicial: numeric('monto_inicial', { precision: 10, scale: 2 }).notNull(),
  monto_final_calculado: numeric('monto_final_calculado', { precision: 10, scale: 2 }).default('0.00'),
  monto_final_real: numeric('monto_final_real', { precision: 10, scale: 2 }),
  diferencia: numeric('diferencia', { precision: 10, scale: 2 }).default('0.00'),
  estado: varchar('estado', { length: 20 }).default('abierta'), // 'abierta', 'cerrada', 'descuadre'
  notas_cierre: text('notas_cierre'),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

export const transacciones_caja = pgTable('transacciones_caja', {
  id_transaccion_caja: uuid('id_transaccion_caja').primaryKey().defaultRandom(),
  id_turno_caja: uuid('id_turno_caja').notNull().references(() => turnos_caja.id_turno_caja),
  id_pedido: uuid('id_pedido').references(() => pedidos.id_pedido),
  tipo_movimiento: varchar('tipo_movimiento', { length: 20 }).notNull(), // 'venta', 'ingreso_manual', 'retiro_manual', 'devolucion'
  metodo_pago: varchar('metodo_pago', { length: 20 }).notNull(), // 'efectivo', 'tarjeta', 'yape', 'plin', 'transferencia'
  monto: numeric('monto', { precision: 10, scale: 2 }).notNull(),
  notas: text('notas'),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

export const turnosCajaRelations = relations(turnos_caja, ({ one, many }) => ({
  usuario_apertura: one(usuarios, { fields: [turnos_caja.id_usuario_apertura], references: [usuarios.id_usuario] }),
  usuario_cierre: one(usuarios, { fields: [turnos_caja.id_usuario_cierre], references: [usuarios.id_usuario] }),
  transacciones: many(transacciones_caja),
  pedidos: many(pedidos),
}));

export const transaccionesCajaRelations = relations(transacciones_caja, ({ one }) => ({
  turno_caja: one(turnos_caja, { fields: [transacciones_caja.id_turno_caja], references: [turnos_caja.id_turno_caja] }),
  pedido: one(pedidos, { fields: [transacciones_caja.id_pedido], references: [pedidos.id_pedido] }),
}));