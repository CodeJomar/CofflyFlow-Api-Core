import { Injectable, NestMiddleware, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { getClientIp } from '../helpers/client-ip';
import { AuditLoggerService } from '../audit/audit-logger.service';
import { detectarAmenaza } from '../security/waf';

/**
 * Cortafuegos de aplicación: revisa URL, agente de usuario, parámetros y cuerpo JSON con las reglas de security/waf.ts.
 * Una petición con firma de ataque se rechaza con 403 y queda en la auditoría de seguridad (sin guardar el cuerpo).
 */
@Injectable()
export class ThreatDetectorMiddleware implements NestMiddleware {
  constructor(private readonly auditLogger: AuditLoggerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const url = req.originalUrl || req.url || '';
    const userAgent = req.headers['user-agent'] || '';

    const motivo = detectarAmenaza({ url, userAgent, query: req.query, body: req.body });
    if (!motivo) {
      next();
      return;
    }

    this.auditLogger.registrarEvento({
      evento: 'AMENAZA_WAF_BLOQUEADA',
      nivel_severidad: 'CRITICAL',
      ip: getClientIp(req),
      user_agent: userAgent,
      detalles: { url: url.slice(0, 300), metodo: req.method, motivo },
    });

    res.status(HttpStatus.FORBIDDEN).json({
      status: 'FORBIDDEN',
      mensajes: [{ codigo: 'SEC_403', descripcion: 'Solicitud bloqueada por los sistemas de protección perimetral.' }],
      trace: '',
    });
  }
}
