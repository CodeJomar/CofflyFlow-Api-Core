import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database/database.provider';
import { codigos_verificacion, sesiones_usuario } from '../database/schema/users.schema';

const CADA_HORAS = 6;
const DIAS_RETENCION_SESIONES = 30;
const DIAS_RETENCION_CODIGOS = 7;

/**
 * Limpieza periódica de credenciales caducadas. Reduce la superficie de ataque (menos hashes de tokens y códigos
 * almacenados) y el tamaño de las tablas. Borra SOLO sesiones expiradas o revocadas hace más de 30 días y códigos
 * de verificación vencidos o usados hace más de 7 días. La auditoría de seguridad no se toca.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private temporizador?: NodeJS.Timeout;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  onModuleInit(): void {
    // Primera pasada poco después de arrancar y luego cada CADA_HORAS (unref: no impide el apagado ordenado).
    setTimeout(() => void this.limpiar(), 60_000).unref();
    this.temporizador = setInterval(() => void this.limpiar(), CADA_HORAS * 3_600_000);
    this.temporizador.unref();
  }

  onModuleDestroy(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  async limpiar(): Promise<void> {
    try {
      const sesiones = await this.db
        .delete(sesiones_usuario)
        .where(
          or(
            lt(sesiones_usuario.expira_en, sql`now() - make_interval(days => ${DIAS_RETENCION_SESIONES})`),
            and(
              eq(sesiones_usuario.revocado, true),
              lt(sesiones_usuario.revocado_el, sql`now() - make_interval(days => ${DIAS_RETENCION_SESIONES})`),
            ),
          ),
        )
        .returning({ id: sesiones_usuario.id_sesion });

      const codigos = await this.db
        .delete(codigos_verificacion)
        .where(
          or(
            lt(codigos_verificacion.expira_en, sql`now() - make_interval(days => ${DIAS_RETENCION_CODIGOS})`),
            and(
              eq(codigos_verificacion.usado, true),
              lt(codigos_verificacion.usado_el, sql`now() - make_interval(days => ${DIAS_RETENCION_CODIGOS})`),
            ),
          ),
        )
        .returning({ id: codigos_verificacion.id_codigo });

      if (sesiones.length > 0 || codigos.length > 0) {
        this.logger.log(`Limpieza: ${sesiones.length} sesión(es) y ${codigos.length} código(s) caducados eliminados.`);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Fallo en la limpieza periódica: ${err.message}`);
    }
  }
}
