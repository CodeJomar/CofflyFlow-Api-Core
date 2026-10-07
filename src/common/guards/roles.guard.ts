import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, PERMISSIONS_KEY, PermisoRequerido } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { IS_AUTHENTICATED_ONLY_KEY } from '../decorators/authenticated.decorator';
import { PermissionsService } from '../security/permissions.service';
import { AuditLoggerService } from '../audit/audit-logger.service';
import { getClientIp } from '../helpers/client-ip';

/**
 * Autorización global, DENEGADA POR DEFECTO. Corre después de JwtAuthGuard (el usuario ya está autenticado).
 *
 *  1. @Public() / @Authenticated()      -> pasa.
 *  2. OWNER (tipo_cuenta)               -> pasa siempre (USR-007).
 *  3. @Roles(...)                       -> pasa si el cargo del usuario está en la lista.
 *  4. @RequirePermission(módulo, acción)-> pasa si la matriz de su cargo lo concede.
 *  5. Cualquier otro caso               -> 403. Un endpoint nuevo sin decorador queda cerrado.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permisos: PermissionsService,
    private readonly audit: AuditLoggerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Los WebSockets se autorizan por evento en el gateway (ver KdsGateway).
    if (context.getType() !== 'http') return true;

    const objetivos = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, objetivos)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED_ONLY_KEY, objetivos)) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new ForbiddenException('Acceso denegado.');

    // OWNER administra todo el negocio y no necesita cargo.
    if (user.tipo_cuenta === 'OWNER') return true;

    const rolesRequeridos = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, objetivos);
    const permisoRequerido = this.reflector.getAllAndOverride<PermisoRequerido>(PERMISSIONS_KEY, objetivos);

    if (user.id_rol) {
      if (rolesRequeridos?.includes(user.rol_nombre)) return true;
      if (permisoRequerido && (await this.permisos.tiene(user.id_rol, permisoRequerido.modulo, permisoRequerido.accion))) {
        return true;
      }
    }

    this.audit.registrarEvento({
      id_usuario: user.id_usuario,
      evento: 'ACCESO_DENEGADO',
      nivel_severidad: 'WARN',
      ip: request.ip ?? getClientIp(request),
      user_agent: request.headers?.['user-agent'] ?? null,
      detalles: {
        ruta: `${request.method} ${request.route?.path ?? request.url?.split('?')[0]}`,
        permiso: permisoRequerido ? `${permisoRequerido.modulo}:${permisoRequerido.accion}` : null,
        cargo: user.rol_nombre ?? null,
      },
    });

    // Mensaje genérico: no revela qué permiso falta ni cómo está configurada la matriz.
    throw new ForbiddenException('No tienes permiso para realizar esta acción.');
  }
}
