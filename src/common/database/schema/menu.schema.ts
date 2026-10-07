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

// Grupos de modificadores (p. ej. "Tipo de leche"). seleccion_minima >= 1 => grupo obligatorio.
export const grupos_modificadores = pgTable('grupos_modificadores', {
  id_grupo: uuid('id_grupo').primaryKey().defaultRandom(),
  nombre: varchar('nombre', { length: 60 }).notNull(),
  descripcion: text('descripcion'),
  seleccion_minima: integer('seleccion_minima').notNull().default(0),
  seleccion_maxima: integer('seleccion_maxima').notNull().default(1),
  orden_visual: integer('orden_visual').default(0),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

// Opciones de un grupo (p. ej. "Avena +2.00"). price_delta puede ser negativo.
export const opciones_modificador = pgTable('opciones_modificador', {
  id_opcion: uuid('id_opcion').primaryKey().defaultRandom(),
  id_grupo: uuid('id_grupo').notNull().references(() => grupos_modificadores.id_grupo),
  nombre: varchar('nombre', { length: 60 }).notNull(),
  price_delta: numeric('price_delta', { precision: 10, scale: 2 }).notNull().default('0.00'),
  disponible: boolean('disponible').default(true),
  orden_visual: integer('orden_visual').default(0),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

// Qué grupos aplican a cada producto.
export const productos_grupos_modificadores = pgTable('productos_grupos_modificadores', {
  id_producto_grupo: uuid('id_producto_grupo').primaryKey().defaultRandom(),
  id_producto: uuid('id_producto').notNull().references(() => productos.id_producto),
  id_grupo: uuid('id_grupo').notNull().references(() => grupos_modificadores.id_grupo),
  orden_visual: integer('orden_visual').default(0),
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