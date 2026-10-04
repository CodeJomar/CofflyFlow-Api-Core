import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../decorators/public.decorator';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';
import { DateUtils } from '../../core/utils/date.utils';
import { DRIZZLE, DrizzleDb } from '../database/database.provider';
import { sql } from 'drizzle-orm';

@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  @Public()
  @Get()
  async check(): Promise<CheckStatus<{ database: string; timestamp: string; version: string }>> {
    let dbStatus = 'DOWN';

    try {
      await this.db.execute(sql`SELECT 1`);
      dbStatus = 'UP';
    } catch {
      dbStatus = 'DOWN';
    }

    const payload = {
      database: dbStatus,
      timestamp: DateUtils.formatearFechaHora(),
      version: '1.0.0',
    };

    return new CheckStatus(
      'OK',
      [new MensajeQuery('HEALTH_200', 'Servicio operativo')],
      '',
      payload,
    );
  }
}