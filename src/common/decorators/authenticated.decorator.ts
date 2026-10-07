import { SetMetadata } from '@nestjs/common';

export const IS_AUTHENTICATED_ONLY_KEY = 'isAuthenticatedOnly';

/**
 * Marca un endpoint al que puede entrar CUALQUIER usuario con sesión, sin exigir un permiso concreto
 * (p. ej. consultar el propio perfil). Es una excepción explícita: por defecto, un endpoint sin
 * @Public(), @Authenticated(), @Roles() ni @RequirePermission() se rechaza.
 */
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED_ONLY_KEY, true);
