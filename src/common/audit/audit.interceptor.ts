import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditLoggerService } from './audit-logger.service';
import { getClientIp } from '../helpers/client-ip';
import { sanitizePayload } from './sanitize-payload';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly auditLogger: AuditLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const inicio = Date.now();
    const req = context.switchToHttp().getRequest();
    const { method, originalUrl } = req;
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'Desconocido';
    const usuario = req.user;

    return next.handle().pipe(
      tap({
        next: () => {
          const latenciaMs = Date.now() - inicio;

          // Solo auditamos mutaciones (POST, PUT, PATCH, DELETE) para evitar sobrecargar la BD
          if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
            const bodySanitizado = sanitizePayload(req.body);

              this.auditLogger.registrarEvento({
                id_usuario: usuario?.id_usuario ?? usuario?.sub ?? null,
                evento: `HTTP_${method}_${(originalUrl || '').split('?')[0]}`.slice(0, 150),
                nivel_severidad: 'INFO',
                ip,
                user_agent: userAgent,
                detalles: {
                  metodo: method,
                  ruta: originalUrl,
                  latencia_ms: latenciaMs,
                  body: bodySanitizado,
                },
              });
            }
          },
          error: (error: unknown) => {
            const latenciaMs = Date.now() - inicio;
            const err = error instanceof Error ? error : new Error(String(error));

            this.auditLogger.registrarEvento({
              id_usuario: usuario?.id_usuario ?? usuario?.sub ?? null,
              evento: `HTTP_ERROR_${method}_${(originalUrl || '').split('?')[0]}`.slice(0, 150),
              nivel_severidad: 'WARN',
              ip,
              user_agent: userAgent,
              detalles: {
                metodo: method,
                ruta: originalUrl,
                latencia_ms: latenciaMs,
                error_mensaje: err.message,
              },
            });
          },
      }),
    );
  }
}