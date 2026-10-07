import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { DRIZZLE, DrizzleDb } from '../../../common/database/database.provider';
import { roles, sesiones_usuario, usuarios } from '../../../common/database/schema/users.schema';
import { COOKIE_ACCESO } from '../auth-cookies';

/** Claims mínimos del access token: la identidad y el estado se resuelven contra la base de datos. */
export interface JwtPayload {
  sub: string;
  sid: string;
  iat?: number;
  exp?: number;
}

export interface UsuarioAutenticado {
  id_usuario: string;
  email: string;
  nombre: string;
  tipo_cuenta: string;
  id_rol: string | null;
  rol_nombre: string | null;
}

function extraerToken(req: Request): string | null {
  const cookies = req?.cookies as Record<string, string> | undefined;
  // Navegador: cookie HttpOnly. Herramientas/clientes no web: Authorization Bearer.
  return cookies?.[COOKIE_ACCESO] ?? ExtractJwt.fromAuthHeaderAsBearerToken()(req);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET no está definido en las variables de entorno.');
    }

    super({
      jwtFromRequest: extraerToken,
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
      algorithms: ['HS256'],
    });
  }

  /**
   * Una petición es válida solo si la sesión sigue vigente y la cuenta está activa. Así logout,
   * baja, suspensión y cambio de contraseña surten efecto de inmediato, sin esperar a que expire el token.
   */
  async validate(payload: JwtPayload): Promise<UsuarioAutenticado> {
    if (!payload.sub || !payload.sid) {
      throw new UnauthorizedException('Sesión no válida.');
    }

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
          eq(sesiones_usuario.id_sesion, payload.sid),
          eq(sesiones_usuario.id_usuario, payload.sub),
          eq(sesiones_usuario.revocado, false),
          gt(sesiones_usuario.expira_en, sql`now()`),
          eq(usuarios.estado, 'activo'),
          eq(usuarios.eliminado, false),
        ),
      )
      .limit(1);

    if (!usuario) {
      throw new UnauthorizedException('Sesión no válida.');
    }

    return usuario;
  }
}
