import { Injectable, NestMiddleware, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { getClientIp } from '../helpers/client-ip';
import { AuditLoggerService } from '../audit/audit-logger.service';

@Injectable()
export class ThreatDetectorMiddleware implements NestMiddleware {
  constructor(private readonly auditLogger: AuditLoggerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    let url = req.originalUrl || req.url || '';
    try {
      url = decodeURIComponent(url);
    } catch {
      // Si la URL contiene encoding malformado, se preserva el raw para análisis
    }
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';

    // 1. Detección de Path Traversal
    const regTraversal = /(\.\.[/\\]|%2e%2e[/\\]|\/etc\/passwd|\/windows\/win\.ini)/i;

    // 2. Detección de scanners y bots agresivos en User-Agent
    const regScanners = /\b(sqlmap|nikto|nmap|masscan|acunetix|dirbuster|gobuster)\b/i;

    // 3. Detección de inyecciones típicas en URI
    const regUriInjection = /<\s*script|union\s+select|benchmark\s*\(|sleep\s*\(/i;

    if (regTraversal.test(url) || regScanners.test(userAgent) || regUriInjection.test(url)) {
      this.auditLogger.registrarEvento({
        evento: 'AMENAZA_WAF_BLOQUEADA',
        nivel_severidad: 'CRITICAL',
        ip,
        user_agent: userAgent,
        detalles: {
          url,
          metodo: req.method,
          motivo: 'Patrón malicioso detectado en URL o cabeceras',
        },
      });

      res.status(HttpStatus.FORBIDDEN).json({
        status: 'FORBIDDEN',
        mensajes: [
          {
            codigo: 'SEC_403',
            descripcion: 'Solicitud bloqueada por los sistemas de protección perimetral.',
          },
        ],
        trace: '',
      });
      return;
    }

    next();
  }
}