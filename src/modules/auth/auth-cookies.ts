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
  // La cookie de acceso dura lo que la sesión (tope SESSION_MAX_HOURS): el JWT que contiene vence antes (JWT_EXPIRATION) y el
  // cliente lo renueva con /auth/refresh; así el Proxy de Next puede saber si hay sesión sin ver el refresh token.
  res.cookie(COOKIE_ACCESO, tokens.acceso, { ...base, path: '/', maxAge: tokens.refrescoSegundos * 1000 });
  res.cookie(COOKIE_REFRESCO, tokens.refresco, { ...base, path: RUTA_REFRESCO, maxAge: tokens.refrescoSegundos * 1000 });
}

export function limpiarCookiesSesion(res: Response): void {
  const base = opcionesBase();
  res.clearCookie(COOKIE_ACCESO, { ...base, path: '/' });
  res.clearCookie(COOKIE_REFRESCO, { ...base, path: RUTA_REFRESCO });
}
