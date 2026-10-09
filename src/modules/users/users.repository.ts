import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { roles, sesiones_usuario, usuarios } from '../../common/database/schema/users.schema';
import { PiiCipherService } from '../../common/security/pii-cipher';
import { DateUtils } from '../../core/utils/date.utils';

/** Vista pública de un usuario (sin password_hash). DNI y teléfono ya vienen descifrados. */
export interface UsuarioSeguro {
  id_usuario: string;
  tipo_cuenta: string;
  id_rol: string | null;
  rol_nombre?: string | null;
  email: string;
  nombre: string;
  estado: string;
  email_verificado: boolean | null;
  ultimo_login: Date | null;
  dni: string | null;
  telefono: string | null;
  fecha_ingreso: string | null;
  fecha_baja: Date | null;
  motivo_baja: string | null;
  fecha_creacion: Date | null;
  fecha_edicion: Date | null;
}

export interface NuevoUsuario {
  id_rol: string;
  email: string;
  password_hash: string;
  nombre: string;
  dni?: string | null;
  telefono?: string | null;
  fecha_ingreso: string;
  usuario_creacion?: string | null;
}

const columnasSeguras = {
  id_usuario: usuarios.id_usuario,
  tipo_cuenta: usuarios.tipo_cuenta,
  id_rol: usuarios.id_rol,
  rol_nombre: roles.nombre,
  email: usuarios.email,
  nombre: usuarios.nombre,
  estado: usuarios.estado,
  email_verificado: usuarios.email_verificado,
  ultimo_login: usuarios.ultimo_login,
  dni: usuarios.dni,
  telefono: usuarios.telefono,
  fecha_ingreso: usuarios.fecha_ingreso,
  fecha_baja: usuarios.fecha_baja,
  motivo_baja: usuarios.motivo_baja,
  fecha_creacion: usuarios.fecha_creacion,
  fecha_edicion: usuarios.fecha_edicion,
};

const columnasAuth = {
  id_usuario: usuarios.id_usuario,
  tipo_cuenta: usuarios.tipo_cuenta,
  id_rol: usuarios.id_rol,
  rol_nombre: roles.nombre,
  email: usuarios.email,
  password_hash: usuarios.password_hash,
  nombre: usuarios.nombre,
  estado: usuarios.estado,
  intentos_fallidos: usuarios.intentos_fallidos,
  bloqueado_hasta: usuarios.bloqueado_hasta,
};

/**
 * Único lugar que habla con la base de datos para usuarios y cargos. El servicio decide reglas de negocio y el
 * repositorio decide cómo se guarda: aquí también se cifra el DNI y el teléfono al escribir y se descifran al leer.
 */
@Injectable()
export class UsersRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly pii: PiiCipherService,
  ) {}

  private aVistaSegura<T extends { dni: string | null; telefono: string | null }>(fila: T): T {
    return { ...fila, dni: this.pii.descifrar(fila.dni), telefono: this.pii.descifrar(fila.telefono) };
  }

  // ---------------------------------------------------------------- cargos

  async buscarCargoVigente(idRol: string): Promise<{ id_rol: string; nombre: string } | null> {
    const [cargo] = await this.db
      .select({ id_rol: roles.id_rol, nombre: roles.nombre })
      .from(roles)
      .where(and(eq(roles.id_rol, idRol), eq(roles.eliminado, false)))
      .limit(1);
    return cargo ?? null;
  }

  listarCargos(): Promise<{ id_rol: string; nombre: string; descripcion: string | null }[]> {
    return this.db
      .select({ id_rol: roles.id_rol, nombre: roles.nombre, descripcion: roles.descripcion })
      .from(roles)
      .where(eq(roles.eliminado, false))
      .orderBy(roles.nombre);
  }

  // ---------------------------------------------------------------- usuarios

  /** ¿Hay otro usuario vigente con este correo? `excluirId` permite ignorar al propio usuario al editar. */
  async existeEmail(email: string, excluirId?: string): Promise<boolean> {
    const condiciones = [eq(usuarios.email, email), eq(usuarios.eliminado, false)];
    if (excluirId) condiciones.push(ne(usuarios.id_usuario, excluirId));
    const [fila] = await this.db.select({ id: usuarios.id_usuario }).from(usuarios).where(and(...condiciones)).limit(1);
    return Boolean(fila);
  }

  async insertar(datos: NuevoUsuario): Promise<UsuarioSeguro> {
    const [nuevo] = await this.db
      .insert(usuarios)
      .values({
        tipo_cuenta: 'EMPLOYEE',
        id_rol: datos.id_rol,
        email: datos.email,
        password_hash: datos.password_hash,
        nombre: datos.nombre,
        dni: this.pii.cifrar(datos.dni),
        telefono: this.pii.cifrar(datos.telefono),
        fecha_ingreso: datos.fecha_ingreso,
        estado: 'pendiente_activacion',
        usuario_creacion: datos.usuario_creacion ?? null,
        usuario_edicion: datos.usuario_creacion ?? null,
      })
      .returning({ id_usuario: usuarios.id_usuario });
    return this.obtener(nuevo.id_usuario) as Promise<UsuarioSeguro>;
  }

  async listar(busqueda: string | undefined, limite: number, offset: number): Promise<{ items: UsuarioSeguro[]; total: number }> {
    const condiciones: SQL[] = [eq(usuarios.eliminado, false)];
    if (busqueda) {
      const termino = `%${busqueda.trim().toLowerCase()}%`;
      condiciones.push(sql`(LOWER(${usuarios.nombre}) LIKE ${termino} OR LOWER(${usuarios.email}) LIKE ${termino})`);
    }
    const donde = and(...condiciones);

    const [conteo] = await this.db.select({ total: count() }).from(usuarios).where(donde);
    const filas = await this.db
      .select(columnasSeguras)
      .from(usuarios)
      .leftJoin(roles, eq(usuarios.id_rol, roles.id_rol))
      .where(donde)
      .orderBy(desc(usuarios.fecha_creacion))
      .limit(limite)
      .offset(offset);

    return { items: filas.map((f) => this.aVistaSegura(f)), total: Number(conteo?.total || 0) };
  }

  async obtener(idUsuario: string): Promise<UsuarioSeguro | null> {
    const [fila] = await this.db
      .select(columnasSeguras)
      .from(usuarios)
      .leftJoin(roles, eq(usuarios.id_rol, roles.id_rol))
      .where(and(eq(usuarios.id_usuario, idUsuario), eq(usuarios.eliminado, false)))
      .limit(1);
    return fila ? this.aVistaSegura(fila) : null;
  }

  /** Actualiza campos; dni y teléfono llegan en claro y se cifran aquí ('' los deja en null). */
  async actualizar(idUsuario: string, campos: Record<string, unknown>): Promise<void> {
    const guardar = { ...campos };
    if ('dni' in guardar) guardar.dni = this.pii.cifrar(guardar.dni as string | null);
    if ('telefono' in guardar) guardar.telefono = this.pii.cifrar(guardar.telefono as string | null);
    await this.db.update(usuarios).set(guardar).where(eq(usuarios.id_usuario, idUsuario));
  }

  async darDeBaja(idUsuario: string, motivo: string | null, idEditor?: string): Promise<void> {
    await this.db
      .update(usuarios)
      .set({
        eliminado: true,
        estado: 'inactivo',
        fecha_baja: DateUtils.ahoraUtc(),
        motivo_baja: motivo,
        fecha_edicion: DateUtils.ahoraUtc(),
        usuario_edicion: idEditor ?? null,
      })
      .where(eq(usuarios.id_usuario, idUsuario));
  }

  async revocarSesiones(idUsuario: string, motivo: string): Promise<void> {
    await this.db
      .update(sesiones_usuario)
      .set({ revocado: true, revocado_el: DateUtils.ahoraUtc(), motivo_revocacion: motivo })
      .where(and(eq(sesiones_usuario.id_usuario, idUsuario), eq(sesiones_usuario.revocado, false)));
  }

  // ---------------------------------------------------------------- consultas para Auth

  async buscarPorEmailParaAuth(email: string) {
    const [usuario] = await this.db
      .select(columnasAuth)
      .from(usuarios)
      .leftJoin(roles, eq(usuarios.id_rol, roles.id_rol))
      .where(and(eq(usuarios.email, email), eq(usuarios.eliminado, false)))
      .limit(1);
    return usuario ?? null;
  }

  async buscarPorIdParaAuth(idUsuario: string) {
    const [usuario] = await this.db
      .select(columnasAuth)
      .from(usuarios)
      .leftJoin(roles, eq(usuarios.id_rol, roles.id_rol))
      .where(and(eq(usuarios.id_usuario, idUsuario), eq(usuarios.eliminado, false)))
      .limit(1);
    return usuario ?? null;
  }

  /**
   * Registra un fallo de login de forma atómica (una sola sentencia con bloqueo de fila).
   * Si el bloqueo anterior ya venció, el contador reinicia en 1.
   */
  async registrarFalloLogin(idUsuario: string, maxIntentos: number, minutosBloqueo: number): Promise<void> {
    await this.db.execute(sql`
      UPDATE usuarios u SET
        intentos_fallidos = s.n,
        bloqueado_hasta = CASE WHEN s.n >= ${maxIntentos} THEN now() + make_interval(mins => ${minutosBloqueo}) ELSE NULL END,
        estado = CASE
          WHEN s.n >= ${maxIntentos} THEN 'bloqueado'
          WHEN u.estado = 'bloqueado' THEN 'activo'
          ELSE u.estado
        END
      FROM (
        SELECT id_usuario,
               CASE WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= now() THEN 1
                    ELSE COALESCE(intentos_fallidos, 0) + 1 END AS n
          FROM usuarios
         WHERE id_usuario = ${idUsuario}
           FOR UPDATE
      ) s
      WHERE u.id_usuario = s.id_usuario
    `);
  }

  /** Resetea el contador de fallos tras un login exitoso; solo levanta el estado 'bloqueado'. */
  async resetearFallosLogin(idUsuario: string): Promise<void> {
    await this.db
      .update(usuarios)
      .set({
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        ultimo_login: DateUtils.ahoraUtc(),
        estado: sql`CASE WHEN ${usuarios.estado} = 'bloqueado' THEN 'activo' ELSE ${usuarios.estado} END`,
      })
      .where(eq(usuarios.id_usuario, idUsuario));
  }
}
