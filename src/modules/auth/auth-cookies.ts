import type { CookieOptions, Response } from 'express';

export const COOKIE_ACCESO = 'cf_access';
export const COOKIE_REFRESCO = 'cf_refresh';
// El refresh token solo viaja a las rutas de auth (refresh/logout).
const RUTA_REFRESCO = '/api/auth';

export interface TokensSesion {
  acceso: string;
  refresco: string;
  accesoSegundos: number;
  refrescoSegundos: number;
}

function opcionesBase(): CookieOptions {
  const sameSiteConfigurada = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  const sameSite = (['lax', 'strict', 'none'].includes(sameSiteConfigurada) ? sameSiteConfigurada : 'lax') as
    | 'lax'
    | 'strict'
    | 'none';
  // SameSite=None exige Secure; en producción Secure es el valor por defecto.
  const secure =
    sameSite === 'none' || (process.env.COOKIE_SECURE ?? String(process.env.NODE_ENV === 'production')) === 'true';

  return {
    httpOnly: true,
    secure,
    sameSite,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  };
}

export function establecerCookiesSesion(res: Response, tokens: TokensSesion): void {
  const base = opcionesBase();
  // Cookies de sesión (sin Max-Age): el navegador las borra al cerrarse, así que cerrar el navegador cierra la sesión.
  // El vencimiento real lo decide el servidor (JWT_EXPIRATION, JWT_REFRESH_EXPIRATION y SESSION_MAX_HOURS), no la cookie;
  // el JWT de acceso vence antes y el cliente lo renueva con /auth/refresh.
  res.cookie(COOKIE_ACCESO, tokens.acceso, { ...base, path: '/' });
  res.cookie(COOKIE_REFRESCO, tokens.refresco, { ...base, path: RUTA_REFRESCO });
}

export function limpiarCookiesSesion(res: Response): void {
  const base = opcionesBase();
  res.clearCookie(COOKIE_ACCESO, { ...base, path: '/' });
  res.clearCookie(COOKIE_REFRESCO, { ...base, path: RUTA_REFRESCO });
}
