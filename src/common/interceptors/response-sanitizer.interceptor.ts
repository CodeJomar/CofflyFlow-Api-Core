import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { sanitizarRespuesta } from '../security/sanitize-response';

/** Quita de TODA respuesta HTTP los campos internos y secretos (ver sanitize-response.ts). */
@Injectable()
export class ResponseSanitizerInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    return next.handle().pipe(map((cuerpo) => sanitizarRespuesta(cuerpo)));
  }
}
