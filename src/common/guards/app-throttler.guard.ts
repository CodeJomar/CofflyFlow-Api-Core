import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Límite de peticiones GLOBAL. Cuenta por usuario autenticado y, si no hay sesión, por IP. Así varias
 * terminales que comparten la IP del local (NAT) no se bloquean entre sí, y un usuario no evade el límite
 * cambiando de IP. Debe registrarse DESPUÉS de JwtAuthGuard para que `req.user` ya exista.
 * Los endpoints sensibles (login, OTP...) fijan límites más estrictos con @Throttle.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /** Este guard aplica el limitador por usuario ('default'); el de IP ('ip') lo evalúa IpThrottlerGuard antes. */
  async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter((t) => t.name !== 'ip');
  }

  protected getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(req.user?.id_usuario ? `u:${req.user.id_usuario}` : `ip:${req.ip}`);
  }

  canActivate(context: ExecutionContext): Promise<boolean> {
    // Los WebSockets tienen su propia limitación por evento (ver KdsGateway).
    if (context.getType() !== 'http') return Promise.resolve(true);
    return super.canActivate(context);
  }
}
