import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Límite por IP que se evalúa ANTES de autenticar: protege frente a inundaciones de peticiones sin sesión o con
 * tokens inválidos (que fallarían en JwtAuthGuard antes de llegar al limitador por usuario). El tope es alto
 * (varias terminales del local comparten IP) y solo corta abusos evidentes. Aplica únicamente el limitador 'ip'.
 */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter((t) => t.name === 'ip');
  }

  protected getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(`ip:${req.ip}`);
  }

  canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return Promise.resolve(true);
    return super.canActivate(context);
  }
}
