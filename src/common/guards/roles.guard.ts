import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, PERMISSIONS_KEY, PermisoRequerido } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { DRIZZLE, DrizzleDb } from '../database/database.provider';
import { rol_permisos, modulos, acciones } from '../database/schema/users.schema';
import { eq, and } from 'drizzle-orm';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const rolesRequeridos = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const permisoRequerido = this.reflector.getAllAndOverride<PermisoRequerido>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Si el endpoint no exige ni roles ni permisos específicos, pasa
    if (!rolesRequeridos && !permisoRequerido) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user || !user.id_rol) {
      throw new ForbiddenException('Acceso denegado: Usuario no autenticado o sin rol asignado.');
    }

    // 1. Validación rápida por nombre de rol si fue especificado
    if (rolesRequeridos && rolesRequeridos.length > 0) {
      if (rolesRequeridos.includes(user.rol_nombre)) {
        return true;
      }
    }

    // 2. Validación profunda contra la matriz rol_permisos (RBAC Dinámico)
    if (permisoRequerido) {
      const permisoExistente = await this.db
        .select()
        .from(rol_permisos)
        .innerJoin(modulos, eq(rol_permisos.id_modulo, modulos.id_modulo))
        .innerJoin(acciones, eq(rol_permisos.id_accion, acciones.id_accion))
        .where(
          and(
            eq(rol_permisos.id_rol, user.id_rol),
            eq(modulos.nombre, permisoRequerido.modulo),
            eq(acciones.nombre, permisoRequerido.accion),
            eq(rol_permisos.eliminado, false),
          ),
        )
        .limit(1);

      if (permisoExistente.length > 0) {
        return true;
      }
    }

    throw new ForbiddenException('Acceso denegado: No posee los permisos requeridos para esta acción.');
  }
}