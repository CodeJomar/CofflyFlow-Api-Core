import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permisos';

export interface PermisoRequerido {
  modulo: string;
  accion: string;
}

export const RequirePermission = (modulo: string, accion: string) =>
  SetMetadata(PERMISSIONS_KEY, { modulo, accion });

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);