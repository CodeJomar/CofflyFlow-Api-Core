import { Global, Module } from '@nestjs/common';
import { AuditLoggerService } from './audit-logger.service';
import { QueueService } from '../services/queue.service';
import { AuditInterceptor } from './audit.interceptor';

@Global()
@Module({
  providers: [QueueService, AuditLoggerService, AuditInterceptor],
  exports: [QueueService, AuditLoggerService, AuditInterceptor],
})
export class AuditModule {}
