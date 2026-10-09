import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { roles, sesiones_usuario, usuarios } from '../../common/database/schema/users.schema';

/** Segundos sin actividad del usuario tras los cuales la sesión muere (SESSION_IDLE_MINUTES, 5 min por defecto). */
export function inactividadSegundos(config: ConfigService): number {
  return Math.max(1, Math.round((Number(config.get('SESSION_IDLE_MINUTES')) || 5) * 60));
}

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
 * (JwtStrategy) y WebSocket (KDS): una sesión revocada, inactiva o una cuenta deshabilitada dejan de servir de inmediato.
 * La inactividad se mide con `ultimo_uso`, que solo mueve la actividad real del usuario (POST /auth/actividad), no las
 * consultas automáticas de las pantallas.
 */
@Injectable()
export class SessionService {
  private readonly inactividad: number;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    config: ConfigService,
  ) {
    this.inactividad = inactividadSegundos(config);
  }

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
          gt(sesiones_usuario.ultimo_uso, sql`now() - make_interval(secs => ${this.inactividad})`),
          eq(usuarios.estado, 'activo'),
          eq(usuarios.eliminado, false),
        ),
      )
      .limit(1);

    return usuario ? { ...usuario, sid: idSesion } : null;
  }
}
