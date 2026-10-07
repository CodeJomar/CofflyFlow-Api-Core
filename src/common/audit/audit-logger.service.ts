import { Injectable, Inject, Logger } from '@nestjs/common';
import { DRIZZLE, DrizzleDb } from '../database/database.provider';
import { auditoria_seguridad } from '../database/schema/users.schema';
import { QueueService } from '../services/queue.service';

export interface EventoAuditoria {
  id_usuario?: string | null;
  evento: string;
  nivel_severidad?: 'INFO' | 'WARN' | 'CRITICAL';
  ip?: string | null;
  user_agent?: string | null;
  detalles?: Record<string, unknown> | null;
}

@Injectable()
export class AuditLoggerService {
  private readonly logger = new Logger(AuditLoggerService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Auditoría DURABLE: se escribe dentro de la transacción del negocio, así que o se confirman ambas o ninguna.
   * Úsala para cambios que exigen trazabilidad (anulaciones, reversiones de estado); el resto usa la cola.
   */
  async registrarEnTransaccion(tx: Pick<DrizzleDb, 'insert'>, eventoData: EventoAuditoria): Promise<void> {
    await tx.insert(auditoria_seguridad).values({
      id_usuario: eventoData.id_usuario ?? null,
      evento: eventoData.evento,
      nivel_severidad: eventoData.nivel_severidad ?? 'INFO',
      ip: eventoData.ip ?? null,
      user_agent: eventoData.user_agent ?? null,
      detalles: eventoData.detalles ?? null,
    });
  }

  registrarEvento(eventoData: EventoAuditoria): void {
    // Se despacha a la cola en segundo plano para cero latencia hacia el cliente
    this.queueService.enqueue(async () => {
      try {
        await this.db.insert(auditoria_seguridad).values({
          id_usuario: eventoData.id_usuario ?? null,
          evento: eventoData.evento,
          nivel_severidad: eventoData.nivel_severidad ?? 'INFO',
          ip: eventoData.ip ?? null,
          user_agent: eventoData.user_agent ?? null,
          detalles: eventoData.detalles ?? null,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`Fallo al persistir auditoría: ${err.message}`);
      }
    });
  }
}