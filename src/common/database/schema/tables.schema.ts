import { pgTable, uuid, varchar, timestamp, boolean, integer } from 'drizzle-orm/pg-core';

export const mesas = pgTable('mesas', {
  id_mesa: uuid('id_mesa').primaryKey().defaultRandom(),
  numero: varchar('numero', { length: 10 }).notNull(), // único entre mesas activas: índice parcial uq_mesas_numero
  area: varchar('area', { length: 30 }), // 'Salón', 'Terraza', 'Barra'... (TAB-003)
  capacidad: integer('capacidad').default(2),
  estado: varchar('estado', { length: 20 }).default('libre'), // 'libre', 'ocupada', 'por_cobrar', 'por_limpiar'
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});