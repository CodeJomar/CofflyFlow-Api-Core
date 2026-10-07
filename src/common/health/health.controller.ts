import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../decorators/public.decorator';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';
import { DateUtils } from '../../core/utils/date.utils';
import { DRIZZLE, DrizzleDb } from '../database/database.provider';
import { sql } from 'drizzle-orm';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /** Liveness: el proceso responde. No toca la base (un fallo de BD no debe reiniciar el contenedor en bucle). */
  @Public()
  @Get(['', 'live'])
  live(): CheckStatus<{ timestamp: string }> {
    return new CheckStatus('OK', [new MensajeQuery('HEALTH_200', 'Servicio operativo')], '', {
      timestamp: DateUtils.formatearFechaHora(),
    });
  }

  /** Readiness: la API puede atender tráfico solo si la base responde. Si no, 503 (el balanceador la saca de rotación). */
  @Public()
  @Get('ready')
  async ready(): Promise<CheckStatus<{ database: string; timestamp: string }>> {
    try {
      await this.db.execute(sql`SELECT 1`);
    } catch {
      throw new ServiceUnavailableException('La base de datos no responde.');
    }
    return new CheckStatus('OK', [new MensajeQuery('HEALTH_200', 'Servicio listo')], '', {
      database: 'UP',
      timestamp: DateUtils.formatearFechaHora(),
    });
  }
}
