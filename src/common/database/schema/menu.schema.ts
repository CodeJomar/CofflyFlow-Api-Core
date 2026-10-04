import { pgTable, uuid, varchar, text, timestamp, boolean, integer, numeric } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const categorias = pgTable('categorias', {
  id_categoria: uuid('id_categoria').primaryKey().defaultRandom(),
  nombre: varchar('nombre', { length: 50 }).notNull(),
  descripcion: text('descripcion'),
  orden_visual: integer('orden_visual').default(0),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

export const productos = pgTable('productos', {
  id_producto: uuid('id_producto').primaryKey().defaultRandom(),
  id_categoria: uuid('id_categoria').notNull().references(() => categorias.id_categoria),
  nombre: varchar('nombre', { length: 100 }).notNull(),
  descripcion: text('descripcion'),
  precio: numeric('precio', { precision: 10, scale: 2 }).notNull(),
  disponible: boolean('disponible').default(true),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

export const categoriasRelations = relations(categorias, ({ many }) => ({
  productos: many(productos),
}));

export const productosRelations = relations(productos, ({ one }) => ({
  categoria: one(categorias, { fields: [productos.id_categoria], references: [categorias.id_categoria] }),
}));