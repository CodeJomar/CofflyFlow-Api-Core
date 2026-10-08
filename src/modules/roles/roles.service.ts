import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { acciones, modulos, rol_permisos, roles, usuarios } from '../../common/database/schema/users.schema';
import { PermissionCatalogService } from '../../common/security/permission-catalog.service';
import { PermissionsService } from '../../common/security/permissions.service';
import { AuditLoggerService } from '../../common/audit/audit-logger.service';
import { DateUtils } from '../../core/utils/date.utils';
import type { UsuarioAutenticado } from '../auth/session.service';
import { CreateRolDto, PermisoDto, UpdateRolDto } from './dto/roles.dto';

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
type Ejecutor = DrizzleDb | Tx;

export interface RolResumen {
  id_rol: string;
  nombre: string;
  descripcion: string | null;
  total_permisos: number;
  total_usuarios: number;
  /** Módulos a los que el cargo tiene algún permiso (para mostrar chips en la lista). */
  modulos: string[];
}

export interface RolDetalle {
  id_rol: string;
  nombre: string;
  descripcion: string | null;
  total_usuarios: number;
  permisos: Array<{ modulo: string; accion: string }>;
}

/**
 * Administración de roles (cargos) y de sus permisos. Los permisos son DATOS (`rol_permisos`): un rol nuevo o un
 * cambio de permisos surte efecto de inmediato, sin tocar código ni desplegar.
 *
 * Seguridad:
 *  - Solo se pueden conceder permisos que existen en el catálogo del código (no se inventan).
 *  - OWNER puede todo. Un usuario con permisos de roles que NO es OWNER no puede escalar privilegios: solo concede
 *    permisos que él mismo tiene y no puede modificar su propio rol.
 *  - No se elimina un rol que tenga usuarios asignados.
 *  - Cada cambio queda en la auditoría de seguridad con lo agregado y lo quitado.
 */
@Injectable()
export class RolesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly catalogo: PermissionCatalogService,
    private readonly permisos: PermissionsService,
    private readonly audit: AuditLoggerService,
  ) {}

  // =========================================================================
  // LECTURA
  // =========================================================================

  async listar(): Promise<RolResumen[]> {
    const filas = await this.db
      .select({
        id_rol: roles.id_rol,
        nombre: roles.nombre,
        descripcion: roles.descripcion,
        total_permisos: sql<number>`(SELECT count(*)::int FROM rol_permisos rp WHERE rp.id_rol = ${roles.id_rol} AND rp.eliminado = FALSE)`,
        total_usuarios: sql<number>`(SELECT count(*)::int FROM usuarios u WHERE u.id_rol = ${roles.id_rol} AND u.eliminado = FALSE)`,
        modulos: sql<string[]>`COALESCE((SELECT array_agg(DISTINCT m.nombre ORDER BY m.nombre) FROM rol_permisos rp JOIN modulos m ON m.id_modulo = rp.id_modulo WHERE rp.id_rol = ${roles.id_rol} AND rp.eliminado = FALSE), ARRAY[]::varchar[])`,
      })
      .from(roles)
      .where(eq(roles.eliminado, false))
      .orderBy(asc(roles.nombre));
    return filas;
  }

  async obtener(idRol: string, ejecutor: Ejecutor = this.db): Promise<RolDetalle> {
    const exec = ejecutor as DrizzleDb;
    const [rol] = await exec.select().from(roles).where(and(eq(roles.id_rol, idRol), eq(roles.eliminado, false))).limit(1);
    if (!rol) throw new NotFoundException('El rol no existe o fue eliminado.');

    const [{ total }] = await exec
      .select({ total: sql<number>`count(*)::int` })
      .from(usuarios)
      .where(and(eq(usuarios.id_rol, idRol), eq(usuarios.eliminado, false)));

    return {
      id_rol: rol.id_rol,
      nombre: rol.nombre,
      descripcion: rol.descripcion,
      total_usuarios: total,
      permisos: await this.permisosDeRol(exec, idRol),
    };
  }

  catalogoPermisos() {
    return this.catalogo.catalogoAgrupado();
  }

  private async permisosDeRol(exec: DrizzleDb, idRol: string): Promise<Array<{ modulo: string; accion: string }>> {
    const filas = await exec
      .select({ modulo: modulos.nombre, accion: acciones.nombre })
      .from(rol_permisos)
      .innerJoin(modulos, eq(rol_permisos.id_modulo, modulos.id_modulo))
      .innerJoin(acciones, eq(rol_permisos.id_accion, acciones.id_accion))
      .where(and(eq(rol_permisos.id_rol, idRol), eq(rol_permisos.eliminado, false)))
      .orderBy(asc(modulos.nombre), asc(acciones.nombre));
    return filas;
  }

  // =========================================================================
  // ESCRITURA
  // =========================================================================

  async crear(dto: CreateRolDto, actor: UsuarioAutenticado): Promise<RolDetalle> {
    const nombre = dto.nombre.trim();
    this.exigirNombreNoReservado(nombre);
    const deseados = this.normalizarPermisos(dto.permisos ?? []);
    await this.exigirPuedeConceder(actor, deseados);

    const idRol = await this.db.transaction(async (tx) => {
      await this.exigirNombreLibre(tx, nombre);
      const [rol] = await tx
        .insert(roles)
        .values({
          nombre,
          descripcion: dto.descripcion?.trim() || null,
          usuario_creacion: actor.id_usuario,
          usuario_edicion: actor.id_usuario,
        })
        .returning({ id_rol: roles.id_rol });
      await this.insertarPermisos(tx, rol.id_rol, deseados, actor.id_usuario);
      return rol.id_rol;
    });

    this.permisos.invalidar(idRol);
    this.auditar('ROL_CREADO', actor, { id_rol: idRol, nombre, permisos: deseados.map((p) => `${p.modulo}:${p.accion}`) });
    return this.obtener(idRol);
  }

  async actualizar(idRol: string, dto: UpdateRolDto, actor: UsuarioAutenticado): Promise<RolDetalle> {
    this.exigirNoEsSuRol(actor, idRol);

    const antes = await this.obtener(idRol);
    const campos: Record<string, unknown> = { fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: actor.id_usuario };

    if (dto.nombre !== undefined) {
      const nombre = dto.nombre.trim();
      this.exigirNombreNoReservado(nombre);
      await this.exigirNombreLibre(this.db, nombre, idRol);
      campos.nombre = nombre;
    }
    if (dto.descripcion !== undefined) campos.descripcion = dto.descripcion.trim() || null;

    await this.db.update(roles).set(campos).where(eq(roles.id_rol, idRol));

    this.auditar('ROL_ACTUALIZADO', actor, { id_rol: idRol, nombre_anterior: antes.nombre, nombre_nuevo: campos.nombre ?? antes.nombre });
    return this.obtener(idRol);
  }

  /** Reemplaza el conjunto completo de permisos del rol: agrega los nuevos y retira los que ya no están. */
  async reemplazarPermisos(idRol: string, permisos: PermisoDto[], actor: UsuarioAutenticado): Promise<RolDetalle> {
    this.exigirNoEsSuRol(actor, idRol);
    const deseados = this.normalizarPermisos(permisos);

    const { agregados, quitados, nombre } = await this.db.transaction(async (tx) => {
      // Se bloquea el rol para que dos ediciones simultáneas no se pisen.
      const [rol] = await tx.select().from(roles).where(and(eq(roles.id_rol, idRol), eq(roles.eliminado, false))).for('update');
      if (!rol) throw new NotFoundException('El rol no existe o fue eliminado.');

      const actuales = new Set((await this.permisosDeRol(tx as unknown as DrizzleDb, idRol)).map((p) => `${p.modulo}:${p.accion}`));
      const clave = (p: PermisoDto) => `${p.modulo}:${p.accion}`;
      const nuevos = deseados.filter((p) => !actuales.has(clave(p)));
      const aQuitar = [...actuales].filter((c) => !deseados.some((p) => clave(p) === c));

      await this.exigirPuedeConceder(actor, nuevos);

      if (aQuitar.length > 0) {
        const pares = aQuitar.map((c) => c.split(':'));
        const ids = await tx
          .select({ id: rol_permisos.id_rol_permiso, modulo: modulos.nombre, accion: acciones.nombre })
          .from(rol_permisos)
          .innerJoin(modulos, eq(rol_permisos.id_modulo, modulos.id_modulo))
          .innerJoin(acciones, eq(rol_permisos.id_accion, acciones.id_accion))
          .where(and(eq(rol_permisos.id_rol, idRol), eq(rol_permisos.eliminado, false)));
        const idsQuitar = ids.filter((f) => pares.some(([m, a]) => m === f.modulo && a === f.accion)).map((f) => f.id);
        if (idsQuitar.length > 0) {
          await tx
            .update(rol_permisos)
            .set({ eliminado: true, fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: actor.id_usuario })
            .where(inArray(rol_permisos.id_rol_permiso, idsQuitar));
        }
      }
      await this.insertarPermisos(tx, idRol, nuevos, actor.id_usuario);

      return { agregados: nuevos.map(clave), quitados: aQuitar, nombre: rol.nombre };
    });

    this.permisos.invalidar(idRol); // surte efecto de inmediato (sin esperar el caché de 60 s)
    if (agregados.length > 0 || quitados.length > 0) {
      this.auditar('PERMISOS_ROL_ACTUALIZADOS', actor, { id_rol: idRol, rol: nombre, agregados, quitados }, 'WARN');
    }
    return this.obtener(idRol);
  }

  async eliminar(idRol: string, actor: UsuarioAutenticado): Promise<void> {
    this.exigirNoEsSuRol(actor, idRol);

    const nombre = await this.db.transaction(async (tx) => {
      const [rol] = await tx.select().from(roles).where(and(eq(roles.id_rol, idRol), eq(roles.eliminado, false))).for('update');
      if (!rol) throw new NotFoundException('El rol no existe o fue eliminado.');

      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(usuarios)
        .where(and(eq(usuarios.id_rol, idRol), eq(usuarios.eliminado, false)));
      if (total > 0) {
        throw new ConflictException(`No se puede eliminar el rol: tiene ${total} usuario(s) asignado(s). Reasígnalos primero.`);
      }

      const baja = { eliminado: true, fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: actor.id_usuario };
      await tx.update(rol_permisos).set(baja).where(and(eq(rol_permisos.id_rol, idRol), eq(rol_permisos.eliminado, false)));
      await tx.update(roles).set(baja).where(eq(roles.id_rol, idRol));
      return rol.nombre;
    });

    this.permisos.invalidar(idRol);
    this.auditar('ROL_ELIMINADO', actor, { id_rol: idRol, nombre }, 'WARN');
  }

  // =========================================================================
  // REGLAS Y APOYO
  // =========================================================================

  /** Quita duplicados y rechaza permisos que no existen en el catálogo del código. */
  private normalizarPermisos(entrada: PermisoDto[]): PermisoDto[] {
    const unicos = new Map<string, PermisoDto>();
    for (const p of entrada) unicos.set(`${p.modulo}:${p.accion}`, { modulo: p.modulo, accion: p.accion });

    const desconocidos = [...unicos.values()].filter((p) => !this.catalogo.existe(p.modulo, p.accion));
    if (desconocidos.length > 0) {
      throw new BadRequestException(`Permisos que no existen: ${desconocidos.map((p) => `${p.modulo}:${p.accion}`).join(', ')}.`);
    }
    return [...unicos.values()];
  }

  /**
   * Anti-escalada: OWNER concede lo que quiera. Cualquier otro usuario solo puede conceder permisos que ÉL MISMO
   * tiene; así nadie se otorga (ni otorga a un cómplice) más poder del que ya posee.
   */
  private async exigirPuedeConceder(actor: UsuarioAutenticado, aConceder: PermisoDto[]): Promise<void> {
    if (actor.tipo_cuenta === 'OWNER' || aConceder.length === 0) return;
    const propios = actor.id_rol ? await this.permisos.permisosDe(actor.id_rol) : new Set<string>();
    const excedidos = aConceder.filter((p) => !propios.has(`${p.modulo}:${p.accion}`));
    if (excedidos.length > 0) {
      throw new ForbiddenException('No puedes conceder permisos que tú mismo no tienes.');
    }
  }

  /** Nadie modifica el rol que lo define a sí mismo (evita autoconcederse poder o auto-bloquearse). OWNER no tiene rol. */
  private exigirNoEsSuRol(actor: UsuarioAutenticado, idRol: string): void {
    if (actor.tipo_cuenta !== 'OWNER' && actor.id_rol === idRol) {
      throw new ForbiddenException('No puedes modificar el rol que tienes asignado.');
    }
  }

  private exigirNombreNoReservado(nombre: string): void {
    if (nombre.toUpperCase() === 'OWNER') {
      throw new BadRequestException('"OWNER" es el tipo de cuenta del propietario y no puede usarse como nombre de rol.');
    }
  }

  private async exigirNombreLibre(ejecutor: Ejecutor, nombre: string, excluirId?: string): Promise<void> {
    const [duplicado] = await (ejecutor as DrizzleDb)
      .select({ id: roles.id_rol })
      .from(roles)
      .where(
        and(
          sql`lower(${roles.nombre}) = lower(${nombre})`,
          eq(roles.eliminado, false),
          excluirId ? sql`${roles.id_rol} != ${excluirId}` : undefined,
        ),
      )
      .limit(1);
    if (duplicado) throw new ConflictException('Ya existe un rol con ese nombre.');
  }

  private async insertarPermisos(tx: Tx, idRol: string, lista: PermisoDto[], idOperador: string): Promise<void> {
    if (lista.length === 0) return;
    const nombresModulo = [...new Set(lista.map((p) => p.modulo))];
    const nombresAccion = [...new Set(lista.map((p) => p.accion))];
    const idsModulo = new Map(
      (await tx.select({ n: modulos.nombre, id: modulos.id_modulo }).from(modulos).where(and(inArray(modulos.nombre, nombresModulo), eq(modulos.eliminado, false)))).map((m) => [m.n, m.id]),
    );
    const idsAccion = new Map(
      (await tx.select({ n: acciones.nombre, id: acciones.id_accion }).from(acciones).where(and(inArray(acciones.nombre, nombresAccion), eq(acciones.eliminado, false)))).map((a) => [a.n, a.id]),
    );

    const filas = lista.map((p) => {
      const id_modulo = idsModulo.get(p.modulo);
      const id_accion = idsAccion.get(p.accion);
      if (!id_modulo || !id_accion) {
        // El catálogo se sincroniza al arrancar la API; si falta la fila es un desfase transitorio.
        throw new BadRequestException(`El permiso ${p.modulo}:${p.accion} aún no está registrado. Reinicia la API para sincronizar el catálogo.`);
      }
      return { id_rol: idRol, id_modulo, id_accion, usuario_creacion: idOperador, usuario_edicion: idOperador };
    });
    await tx.insert(rol_permisos).values(filas);
  }

  private auditar(evento: string, actor: UsuarioAutenticado, detalles: Record<string, unknown>, nivel: 'INFO' | 'WARN' = 'INFO'): void {
    this.audit.registrarEvento({ id_usuario: actor.id_usuario, evento, nivel_severidad: nivel, detalles });
  }
}
