import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { getCorsOrigins } from '../config/cors-origins';
import { COOKIE_ACCESO, COOKIE_REFRESCO } from '../../modules/auth/auth-cookies';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protección CSRF para peticiones autenticadas por cookie: toda petición que modifica estado y
 * trae cookies de sesión debe venir de un origen web autorizado (cabecera Origin o, en su defecto, Referer).
 * Las peticiones sin cookies de sesión (login, Bearer, herramientas) no se ven afectadas.
 */
@Injectable()
export class CsrfOriginMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (METODOS_SEGUROS.has(req.method)) return next();

    const cookies = req.cookies as Record<string, string> | undefined;
    if (!cookies?.[COOKIE_ACCESO] && !cookies?.[COOKIE_REFRESCO]) return next();

    const origen = req.headers.origin ?? this.origenDeReferer(req.headers.referer);
    if (!origen || !getCorsOrigins().includes(origen)) {
      throw new ForbiddenException('Origen no autorizado.');
    }
    next();
  }

  private origenDeReferer(referer: string | undefined): string | undefined {
    if (!referer) return undefined;
    try {
      return new URL(referer).origin;
    } catch {
      return undefined;
    }
  }
}
