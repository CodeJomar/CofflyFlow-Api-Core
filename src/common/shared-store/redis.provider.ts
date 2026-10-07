import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Conexión a Redis (opcional). Con REDIS_URL el estado que debe ser común a todas las instancias de la API
 * (límites de peticiones, intentos de login y difusión de eventos WebSocket) vive en Redis. Sin REDIS_URL se usa
 * memoria local: correcto para desarrollo o una sola instancia, pero no para escalar horizontalmente.
 * Falla rápido (sin cola offline): si Redis cae, cada consumidor degrada a memoria en vez de colgar la petición.
 */
export const redisProvider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis | null => {
    const url = config.get<string>('REDIS_URL')?.trim();
    if (!url) return null;

    const logger = new Logger('Redis');
    const cliente = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      retryStrategy: (intento) => Math.min(intento * 200, 5000),
    });

    let ultimoAviso = 0;
    cliente.on('error', (error) => {
      // Un aviso cada 30 s como máximo para no inundar los logs mientras Redis está caído.
      if (Date.now() - ultimoAviso < 30_000) return;
      ultimoAviso = Date.now();
      logger.warn(`Redis no disponible, se usa memoria local: ${error.message}`);
    });
    cliente.on('ready', () => logger.log('Conectado a Redis.'));
    return cliente;
  },
};
