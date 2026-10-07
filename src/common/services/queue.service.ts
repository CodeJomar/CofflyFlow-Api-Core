import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';

export type TaskHandler = () => Promise<void>;

const ESPERA_MAXIMA_APAGADO_MS = 5000;

/** Cola en segundo plano (auditoría de eventos no críticos, correos). Al apagar la API se vacía antes de cerrar. */
@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private queue: TaskHandler[] = [];
  private processing = false;

  enqueue(task: TaskHandler): void {
    this.queue.push(task);
    void this.processNext();
  }

  /** Espera (con tope) a que se procesen las tareas pendientes para no perder eventos en un apagado ordenado. */
  async onApplicationShutdown(): Promise<void> {
    const limite = Date.now() + ESPERA_MAXIMA_APAGADO_MS;
    while ((this.processing || this.queue.length > 0) && Date.now() < limite) {
      await new Promise((resolver) => setTimeout(resolver, 50));
    }
    if (this.queue.length > 0) this.logger.warn(`Apagado con ${this.queue.length} tarea(s) sin procesar.`);
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const currentTask = this.queue.shift();

    if (currentTask) {
      try {
        await currentTask();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`Error procesando tarea en segundo plano: ${err.message}`, err.stack);
      } finally {
        this.processing = false;
        void this.processNext();
      }
    }
  }
}
