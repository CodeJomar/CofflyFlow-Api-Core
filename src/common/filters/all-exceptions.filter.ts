import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { BaseResponse } from '../../core/dto/base-response.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';
import { randomUUID } from 'crypto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    // Mismo identificador que la cabecera X-Request-Id (RequestIdMiddleware).
    const traceId = (request as Request & { id?: string }).id ?? randomUUID();

    let statusHttp = HttpStatus.INTERNAL_SERVER_ERROR;
    let statusTexto = 'INTERNAL_SERVER_ERROR';
    let codigoError = 'ERR_500';
    let descripcionError = 'Ha ocurrido un error inesperado en el servidor.';
    const extras: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      statusHttp = exception.getStatus();
      statusTexto = HttpStatus[statusHttp] || 'ERROR';
      const excepcionRespuesta = exception.getResponse();

      if (typeof excepcionRespuesta === 'object' && excepcionRespuesta !== null) {
        const respuestaObj = excepcionRespuesta as Record<string, unknown>;
        const mensajeObj = respuestaObj.message;
        // Datos de apoyo para el frontend (login): intentos restantes y tiempo de espera.
        if (typeof respuestaObj.intentos_restantes === 'number') extras.intentos_restantes = respuestaObj.intentos_restantes;
        if (typeof respuestaObj.retry_after_segundos === 'number') {
          extras.retry_after_segundos = respuestaObj.retry_after_segundos;
          response.setHeader('Retry-After', String(respuestaObj.retry_after_segundos));
        }

        if (Array.isArray(mensajeObj)) {
          // Errores de validación de class-validator
          descripcionError = mensajeObj.join(' | ');
          codigoError = 'VAL_400';
        } else if (typeof mensajeObj === 'string') {
          descripcionError = mensajeObj;
          codigoError = `ERR_${statusHttp}`;
        }
      } else if (typeof excepcionRespuesta === 'string') {
        descripcionError = excepcionRespuesta;
        codigoError = `ERR_${statusHttp}`;
      }
    } else if (this.errorCliente(exception)) {
      // Errores 4xx de librerías (body-parser: cuerpo demasiado grande, JSON mal formado...). No son fallos del servidor.
      const e = exception as { status?: number; statusCode?: number; type?: string };
      statusHttp = e.status ?? e.statusCode ?? HttpStatus.BAD_REQUEST;
      statusTexto = HttpStatus[statusHttp] || 'BAD_REQUEST';
      codigoError = `ERR_${statusHttp}`;
      descripcionError =
        e.type === 'entity.too.large'
          ? 'El cuerpo de la petición excede el tamaño permitido.'
          : e.type === 'entity.parse.failed'
            ? 'El cuerpo de la petición no es un JSON válido.'
            : 'La solicitud es inválida.';
    } else if (this.codigoPg(exception)) {
      // Manejo específico de errores de base de datos PostgreSQL (el ORM puede envolverlos en `cause`)
      const original = (exception as { cause?: object }).cause ?? exception;
      const pgError = { ...(original as object), code: this.codigoPg(exception)! } as { code: string; detail?: string; message?: string };
      
      switch (pgError.code) {
        case '23505': // Unique violation
          statusHttp = HttpStatus.CONFLICT;
          statusTexto = 'CONFLICT';
          codigoError = 'PG_23505';
          descripcionError = 'Ya existe un registro con los datos suministrados.';
          break;
        case '23503': // Foreign key violation
          statusHttp = HttpStatus.BAD_REQUEST;
          statusTexto = 'BAD_REQUEST';
          codigoError = 'PG_23503';
          descripcionError = 'Operación inválida: registro relacionado no encontrado o bloqueado.';
          break;
        case '23502': // Not null violation
          statusHttp = HttpStatus.BAD_REQUEST;
          statusTexto = 'BAD_REQUEST';
          codigoError = 'PG_23502';
          descripcionError = 'Faltan campos obligatorios para completar la operación.';
          break;
        default:
          this.logger.error(`Error PostgreSQL no controlado [${pgError.code}]: ${pgError.message}`);
          break;
      }
    } else {
      const err = exception as Error;
      this.logger.error(`Error no controlado [Trace: ${traceId}]: ${err?.message}`, err?.stack);
    }

    const respuestaFinal = new BaseResponse(
      statusTexto,
      [new MensajeQuery(codigoError, descripcionError)],
      traceId,
    );

    if (statusHttp === HttpStatus.TOO_MANY_REQUESTS && codigoError === 'ERR_429' && !extras.retry_after_segundos) {
      respuestaFinal.mensajes = [new MensajeQuery('ERR_429', 'Demasiadas solicitudes. Espera un momento antes de volver a intentar.')];
    }

    response.status(statusHttp).json({ ...respuestaFinal, ...extras });
  }

  private codigoPg(exception: unknown): string | undefined {
    const e = exception as { code?: unknown; cause?: { code?: unknown } } | null;
    const codigo = e?.code ?? e?.cause?.code;
    return typeof codigo === 'string' && /^[0-9A-Z]{5}$/.test(codigo) ? codigo : undefined;
  }

  private errorCliente(exception: unknown): boolean {
    const e = exception as { status?: unknown; statusCode?: unknown; expose?: unknown } | null;
    const estado = e?.status ?? e?.statusCode;
    return typeof estado === 'number' && estado >= 400 && estado < 500 && e?.expose === true;
  }
}
