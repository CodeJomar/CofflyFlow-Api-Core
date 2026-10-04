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
    const traceId = randomUUID();

    let statusHttp = HttpStatus.INTERNAL_SERVER_ERROR;
    let statusTexto = 'INTERNAL_SERVER_ERROR';
    let codigoError = 'ERR_500';
    let descripcionError = 'Ha ocurrido un error inesperado en el servidor.';

    if (exception instanceof HttpException) {
      statusHttp = exception.getStatus();
      statusTexto = HttpStatus[statusHttp] || 'ERROR';
      const excepcionRespuesta = exception.getResponse();

      if (typeof excepcionRespuesta === 'object' && excepcionRespuesta !== null) {
        const respuestaObj = excepcionRespuesta as Record<string, unknown>;
        const mensajeObj = respuestaObj.message;

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
    } else if (typeof exception === 'object' && exception !== null && 'code' in exception) {
      // Manejo específico de errores de base de datos PostgreSQL
      const pgError = exception as { code: string; detail?: string; message?: string };
      
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

    response.status(statusHttp).json(respuestaFinal);
  }
}