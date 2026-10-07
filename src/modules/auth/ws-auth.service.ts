import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { COOKIE_ACCESO } from './auth-cookies';
import { SessionService, UsuarioAutenticado } from './session.service';

const AUDIENCIA_WS = 'kds-ws';
export const TICKET_WS_SEGUNDOS = 30;

interface ClaimsSesion {
  sub?: string;
  sid?: string;
  aud?: string;
}

/**
 * Autenticación de WebSocket. El navegador pide un ticket de 30 s con su sesión HTTP (POST /auth/ws-ticket) y lo
 * presenta en el handshake de Socket.IO (`auth: { ticket }`); así funciona aunque web y API estén en dominios
 * distintos. Como alternativa, si el handshake trae la cookie de acceso (mismo sitio) también se acepta.
 * En ambos casos la sesión se valida contra la base de datos.
 */
@Injectable()
export class WsAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly sesiones: SessionService,
  ) {}

  emitirTicket(usuario: Pick<UsuarioAutenticado, 'id_usuario' | 'sid'>): string {
    return this.jwt.sign({ sub: usuario.id_usuario, sid: usuario.sid, aud: AUDIENCIA_WS }, { expiresIn: `${TICKET_WS_SEGUNDOS}s` });
  }

  async autenticar(socket: Socket): Promise<UsuarioAutenticado | null> {
    const ticket = (socket.handshake.auth as { ticket?: unknown } | undefined)?.ticket;
    const cookie = this.leerCookie(socket.handshake.headers.cookie, COOKIE_ACCESO);

    try {
      if (typeof ticket === 'string' && ticket) {
        const claims = this.jwt.verify<ClaimsSesion>(ticket, { algorithms: ['HS256'] });
        if (claims.aud !== AUDIENCIA_WS) return null;
        return this.resolver(claims);
      }
      if (cookie) {
        const claims = this.jwt.verify<ClaimsSesion>(cookie, { algorithms: ['HS256'] });
        if (claims.aud) return null; // un ticket no se acepta como cookie de acceso
        return this.resolver(claims);
      }
    } catch {
      return null; // token inválido o vencido
    }
    return null;
  }

  /** Vuelve a comprobar que la sesión del socket sigue vigente (logout, baja o suspensión). */
  revalidar(usuario: UsuarioAutenticado): Promise<UsuarioAutenticado | null> {
    return this.sesiones.usuarioDeSesion(usuario.id_usuario, usuario.sid);
  }

  private resolver(claims: ClaimsSesion): Promise<UsuarioAutenticado | null> {
    if (!claims.sub || !claims.sid) return Promise.resolve(null);
    return this.sesiones.usuarioDeSesion(claims.sub, claims.sid);
  }

  private leerCookie(cabecera: string | undefined, nombre: string): string | undefined {
    if (!cabecera) return undefined;
    for (const parte of cabecera.split(';')) {
      const i = parte.indexOf('=');
      if (i > 0 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
    }
    return undefined;
  }
}
