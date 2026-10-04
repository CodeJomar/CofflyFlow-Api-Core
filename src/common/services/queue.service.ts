import { Injectable, Logger } from '@nestjs/common';

export type TaskHandler = () => Promise<void>;

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private queue: TaskHandler[] = [];
  private processing = false;

  enqueue(task: TaskHandler): void {
    this.queue.push(task);
    this.processNext();
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
        this.processNext();
      }
    }
  }
}