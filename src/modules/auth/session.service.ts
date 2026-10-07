import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { roles, sesiones_usuario, usuarios } from '../../common/database/schema/users.schema';

export interface UsuarioAutenticado {
  id_usuario: string;
  /** Id de la sesión (sesiones_usuario) a la que pertenece el token. */
  sid: string;
  email: string;
  nombre: string;
  tipo_cuenta: string;
  id_rol: string | null;
  rol_nombre: string | null;
}

/**
 * Resuelve el usuario de una sesión contra la base de datos. Es la única fuente de verdad para HTTP
 * (JwtStrategy) y WebSocket (KDS): una sesión revocada o una cuenta deshabilitada dejan de servir de inmediato.
 */
@Injectable()
export class SessionService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async usuarioDeSesion(idUsuario: string, idSesion: string): Promise<UsuarioAutenticado | null> {
    const [usuario] = await this.db
      .select({
        id_usuario: usuarios.id_usuario,
        email: usuarios.email,
        nombre: usuarios.nombre,
        tipo_cuenta: usuarios.tipo_cuenta,
        id_rol: usuarios.id_rol,
        rol_nombre: roles.nombre,
      })
      .from(sesiones_usuario)
      .innerJoin(usuarios, eq(usuarios.id_usuario, sesiones_usuario.id_usuario))
      .leftJoin(roles, eq(roles.id_rol, usuarios.id_rol))
      .where(
        and(
          eq(sesiones_usuario.id_sesion, idSesion),
          eq(sesiones_usuario.id_usuario, idUsuario),
          eq(sesiones_usuario.revocado, false),
          gt(sesiones_usuario.expira_en, sql`now()`),
          eq(usuarios.estado, 'activo'),
          eq(usuarios.eliminado, false),
        ),
      )
      .limit(1);

    return usuario ? { ...usuario, sid: idSesion } : null;
  }
}
