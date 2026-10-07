import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule, ObserveInstrument } from './app.module';
import { observeHabilitado } from './common/config/observe.config';
import { getCorsOrigins } from './common/config/cors-origins';
import { RedisIoAdapter } from './common/shared-store/redis-io.adapter';
import { REDIS_CLIENT } from './common/shared-store/redis.provider';
import type Redis from 'ioredis';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

process.env.TZ = process.env.TZ || 'America/Lima';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Solo se instrumenta si el APM está habilitado por entorno (opt-in).
    instrument: observeHabilitado() ? ObserveInstrument : undefined,
  });

  // El frontend consume NEXT_PUBLIC_API_URL=<host>/api. La raíz y /health quedan
  // fuera del prefijo porque el healthcheck del Dockerfile consulta /health.
  app.setGlobalPrefix('api', { exclude: ['/', 'health', 'health/live', 'health/ready'] });

  // Un pedido o formulario real pesa unos pocos KB: 100 KB corta cuerpos abusivos antes de procesarlos.
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: false });

  // Eventos WebSocket por Redis (si hay REDIS_URL) para que lleguen a todas las instancias.
  app.useWebSocketAdapter(new RedisIoAdapter(app, app.get<Redis | null>(REDIS_CLIENT)));

  // Cierre ordenado al recibir SIGTERM/SIGINT (despliegues): termina peticiones en curso y cierra conexiones.
  app.enableShutdownHooks();

  // Cuántos proxies de confianza hay delante (0 = ninguno, la API recibe conexiones directas). Con N, req.ip es la
  // dirección que añadió el proxy N-ésimo: lo que el cliente escriba en X-Forwarded-For más a la izquierda se ignora.
  const saltosProxy = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
  app.set('trust proxy', Number.isInteger(saltosProxy) && saltosProxy >= 0 ? saltosProxy : 1);

  app.use(helmet());
  app.use(cookieParser());

  // Sin CORS_ORIGIN solo se permite el origen por defecto del frontend en desarrollo.
  app.enableCors({ origin: getCorsOrigins(), credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT ?? 4000;
  await app.listen(port, '0.0.0.0');
}
void bootstrap();