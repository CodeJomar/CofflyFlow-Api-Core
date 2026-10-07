import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule, ObserveInstrument } from './app.module';
import { getCorsOrigins } from './common/config/cors-origins';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

process.env.TZ = process.env.TZ || 'America/Lima';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
  });

  // El frontend consume NEXT_PUBLIC_API_URL=<host>/api. La raíz y /health quedan
  // fuera del prefijo porque el healthcheck del Dockerfile consulta /health.
  app.setGlobalPrefix('api', { exclude: ['/', 'health'] });

  // Necesario para que req.ip (y el throttler) refleje la IP real detrás del proxy.
  app.set('trust proxy', Number(process.env.TRUSTED_PROXY_HOPS) || 1);

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