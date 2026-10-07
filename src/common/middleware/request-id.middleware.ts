import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Asigna un identificador de correlación a cada petición (cabecera de respuesta X-Request-Id). El mismo
 * identificador aparece como `trace` en las respuestas de error, para cruzar un reporte del usuario con los logs
 * sin exponer detalles internos. El valor se genera siempre en el servidor: nunca se acepta uno enviado por el cliente.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { id?: string }, res: Response, next: NextFunction): void {
    req.id = randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  }
}
