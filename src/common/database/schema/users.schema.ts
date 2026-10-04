import { pgTable, uuid, varchar, text, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// 1. Módulos del Sistema
export const modulos = pgTable('modulos', {
  id_modulo: uuid('id_modulo').primaryKey().defaultRandom(),
  nombre: varchar('nombre', { length: 50 }).notNull(),
  descripcion: text('descripcion'),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

// 2. Acciones del Sistema
export const acciones = pgTable('acciones', {
  id_accion: uuid('id_accion').primaryKey().defaultRandom(),
  nombre: varchar('nombre', { length: 50 }).notNull(),
  descripcion: text('descripcion'),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

// 3. Roles
export const roles = pgTable('roles', {
  id_rol: uuid('id_rol').primaryKey().defaultRandom(),
  nombre: varchar('nombre', { length: 50 }).notNull(),
  descripcion: text('descripcion'),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

// 4. Matriz de Permisos (RBAC Dinámico)
export const rol_permisos = pgTable('rol_permisos', {
  id_rol_permiso: uuid('id_rol_permiso').primaryKey().defaultRandom(),
  id_rol: uuid('id_rol').notNull().references(() => roles.id_rol, { onDelete: 'cascade' }),
  id_modulo: uuid('id_modulo').notNull().references(() => modulos.id_modulo, { onDelete: 'cascade' }),
  id_accion: uuid('id_accion').notNull().references(() => acciones.id_accion, { onDelete: 'cascade' }),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

// 5. Usuarios
export const usuarios = pgTable('usuarios', {
  id_usuario: uuid('id_usuario').primaryKey().defaultRandom(),
  id_rol: uuid('id_rol').notNull().references(() => roles.id_rol),
  email: varchar('email', { length: 150 }).notNull().unique(),
  password_hash: varchar('password_hash', { length: 255 }).notNull(),
  nombre: varchar('nombre', { length: 100 }).notNull(),
  estado: varchar('estado', { length: 20 }).default('activo'),
  email_verificado: boolean('email_verificado').default(false),
  email_verificado_el: timestamp('email_verificado_el', { withTimezone: true }),
  intentos_fallidos: integer('intentos_fallidos').default(0),
  bloqueado_hasta: timestamp('bloqueado_hasta', { withTimezone: true }),
  ultimo_login: timestamp('ultimo_login', { withTimezone: true }),
  ultimo_cambio_password: timestamp('ultimo_cambio_password', { withTimezone: true }).defaultNow(),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

// 6. Códigos de Verificación y OTP
export const codigos_verificacion = pgTable('codigos_verificacion', {
  id_codigo: uuid('id_codigo').primaryKey().defaultRandom(),
  id_usuario: uuid('id_usuario').notNull().references(() => usuarios.id_usuario, { onDelete: 'cascade' }),
  tipo: varchar('tipo', { length: 30 }).notNull(),
  codigo_hash: varchar('codigo_hash', { length: 255 }).notNull(),
  expira_en: timestamp('expira_en', { withTimezone: true }).notNull(),
  intentos: integer('intentos').default(0),
  max_intentos: integer('max_intentos').default(5),
  usado: boolean('usado').default(false),
  usado_el: timestamp('usado_el', { withTimezone: true }),
  ip_solicitud: varchar('ip_solicitud', { length: 45 }),
  user_agent_solicitud: text('user_agent_solicitud'),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

// 7. Sesiones de Usuario y Rotación de Refresh Tokens
export const sesiones_usuario = pgTable('sesiones_usuario', {
  id_sesion: uuid('id_sesion').primaryKey().defaultRandom(),
  id_usuario: uuid('id_usuario').notNull().references(() => usuarios.id_usuario, { onDelete: 'cascade' }),
  refresh_token_hash: varchar('refresh_token_hash', { length: 255 }).notNull(),
  familia_token: uuid('familia_token').defaultRandom(),
  expira_en: timestamp('expira_en', { withTimezone: true }).notNull(),
  revocado: boolean('revocado').default(false),
  revocado_el: timestamp('revocado_el', { withTimezone: true }),
  motivo_revocacion: varchar('motivo_revocacion', { length: 100 }),
  ip_origen: varchar('ip_origen', { length: 45 }),
  user_agent: text('user_agent'),
  nombre_dispositivo: varchar('nombre_dispositivo', { length: 100 }),
  ultimo_uso: timestamp('ultimo_uso', { withTimezone: true }).defaultNow(),
  usuario_creacion: uuid('usuario_creacion'),
  usuario_edicion: uuid('usuario_edicion'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
  fecha_edicion: timestamp('fecha_edicion', { withTimezone: true }).defaultNow(),
  eliminado: boolean('eliminado').default(false),
});

// 8. Log Inmutable de Auditoría de Seguridad (OWASP A09)
export const auditoria_seguridad = pgTable('auditoria_seguridad', {
  id_auditoria: uuid('id_auditoria').primaryKey().defaultRandom(),
  id_usuario: uuid('id_usuario'),
  evento: varchar('evento', { length: 150 }).notNull(),
  nivel_severidad: varchar('nivel_severidad', { length: 20 }).default('INFO'),
  ip: varchar('ip', { length: 45 }),
  user_agent: text('user_agent'),
  detalles: jsonb('detalles'),
  fecha_creacion: timestamp('fecha_creacion', { withTimezone: true }).defaultNow(),
});

// Relaciones Drizzle
export const usuariosRelations = relations(usuarios, ({ one, many }) => ({
  rol: one(roles, { fields: [usuarios.id_rol], references: [roles.id_rol] }),
  sesiones: many(sesiones_usuario),
  codigos: many(codigos_verificacion),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  usuarios: many(usuarios),
  permisos: many(rol_permisos),
}));

export const rolPermisosRelations = relations(rol_permisos, ({ one }) => ({
  rol: one(roles, { fields: [rol_permisos.id_rol], references: [roles.id_rol] }),
  modulo: one(modulos, { fields: [rol_permisos.id_modulo], references: [modulos.id_modulo] }),
  accion: one(acciones, { fields: [rol_permisos.id_accion], references: [acciones.id_accion] }),
}));