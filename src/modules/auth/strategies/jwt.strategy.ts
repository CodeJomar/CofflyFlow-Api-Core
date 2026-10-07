import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { COOKIE_ACCESO } from '../auth-cookies';
import { SessionService, UsuarioAutenticado } from '../session.service';

export type { UsuarioAutenticado };

/** Claims mínimos del access token: la identidad y el estado se resuelven contra la base de datos. */
export interface JwtPayload {
  sub: string;
  sid: string;
  /** Presente solo en tokens de propósito especial (p. ej. ticket de WebSocket), que NO sirven para la API HTTP. */
  aud?: string;
  iat?: number;
  exp?: number;
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
    private readonly sesiones: SessionService,
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
    // Los tokens con audiencia (tickets de WebSocket) no son tokens de acceso a la API.
    if (!payload.sub || !payload.sid || payload.aud) {
      throw new UnauthorizedException('Sesión no válida.');
    }

    const usuario = await this.sesiones.usuarioDeSesion(payload.sub, payload.sid);
    if (!usuario) {
      throw new UnauthorizedException('Sesión no válida.');
    }
    return usuario;
  }
}
