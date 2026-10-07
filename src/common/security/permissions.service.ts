import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database/database.provider';
import { acciones, modulos, rol_permisos } from '../database/schema/users.schema';

const TTL_MS = 60_000;

/**
 * Consulta la matriz de permisos de un cargo. Carga todos los permisos del cargo en una consulta y los
 * conserva 60 s en memoria, para no ir a la base en cada petición. `invalidar()` fuerza la recarga
 * (úsese al modificar `rol_permisos`).
 */
@Injectable()
export class PermissionsService {
  private readonly cache = new Map<string, { expira: number; permisos: Set<string> }>();

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async tiene(idRol: string, modulo: string, accion: string): Promise<boolean> {
    return (await this.permisosDe(idRol)).has(`${modulo}:${accion}`);
  }

  /** ¿Puede el usuario? (OWNER siempre). Versión que no lanza, para decidir qué incluir en una respuesta. */
  async puede(usuario: { tipo_cuenta: string; id_rol: string | null }, modulo: string, accion: string): Promise<boolean> {
    if (usuario.tipo_cuenta === 'OWNER') return true;
    return usuario.id_rol ? this.tiene(usuario.id_rol, modulo, accion) : false;
  }

  /** Lanza 403 si el usuario no puede (OWNER siempre puede). Para permisos que dependen de los datos de la petición. */
  async exigir(usuario: { tipo_cuenta: string; id_rol: string | null }, modulo: string, accion: string): Promise<void> {
    if (usuario.tipo_cuenta === 'OWNER') return;
    if (usuario.id_rol && (await this.tiene(usuario.id_rol, modulo, accion))) return;
    throw new ForbiddenException('No tienes permiso para realizar esta acción.');
  }

  async permisosDe(idRol: string): Promise<Set<string>> {
    const guardado = this.cache.get(idRol);
    if (guardado && guardado.expira > Date.now()) return guardado.permisos;

    const filas = await this.db
      .select({ modulo: modulos.nombre, accion: acciones.nombre })
      .from(rol_permisos)
      .innerJoin(modulos, eq(rol_permisos.id_modulo, modulos.id_modulo))
      .innerJoin(acciones, eq(rol_permisos.id_accion, acciones.id_accion))
      .where(
        and(
          eq(rol_permisos.id_rol, idRol),
          eq(rol_permisos.eliminado, false),
          eq(modulos.eliminado, false),
          eq(acciones.eliminado, false),
        ),
      );

    const permisos = new Set(filas.map((f) => `${f.modulo}:${f.accion}`));
    this.cache.set(idRol, { expira: Date.now() + TTL_MS, permisos });
    return permisos;
  }

  invalidar(idRol?: string): void {
    if (idRol) this.cache.delete(idRol);
    else this.cache.clear();
  }
}
