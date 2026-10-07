import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ResponseSanitizerInterceptor } from './common/interceptors/response-sanitizer.interceptor';
import { ThrottlerModule } from '@nestjs/throttler';
import { validarEntorno } from './common/config/env.validation';
import { observeHabilitado, opcionesObserve } from './common/config/observe.config';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { IpThrottlerGuard } from './common/guards/ip-throttler.guard';
import { MaintenanceService } from './common/maintenance/maintenance.service';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

// Controladores y Servicios Base
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Infraestructura y Seguridad Core
import { DatabaseModule } from './common/database/database.module';
import { AuditModule } from './common/audit/audit.module';
import type Redis from 'ioredis';
import { SharedStoreModule } from './common/shared-store/shared-store.module';
import { REDIS_CLIENT } from './common/shared-store/redis.provider';
import { RedisThrottlerStorage } from './common/shared-store/redis-throttler-storage';
import { RealtimeModule } from './common/realtime/realtime.module';
import { HealthModule } from './common/health/health.module';
import { MailModule } from './common/mail/mail.module';
import { SecurityModule } from './common/security/security.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ThreatDetectorMiddleware } from './common/middleware/threat-detector.middleware';
import { CsrfOriginMiddleware } from './common/middleware/csrf-origin.middleware';

// Módulos de Negocio Coffly Flow
import { AuthModule } from './modules/auth/auth.module';
import { UsersApiModule } from './modules/users/users-api.module';
import { RolesModule } from './modules/roles/roles.module';
import { MenuModule } from './modules/menu/menu.module';
import { TablesModule } from './modules/tables/tables.module';
import { OrdersModule } from './modules/orders/orders.module';
import { KdsModule } from './modules/kds/kds.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // 1. Configuración de Entorno Global (.env)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validarEntorno, // la API no arranca con secretos ausentes o débiles
    }),

    // Límite global por usuario (o IP sin sesión). Los endpoints sensibles fijan uno más estricto con @Throttle.
    // 'default': por usuario (o IP sin sesión), 300/min. 'ip': tope por IP antes de autenticar, 1200/min.
    // Con REDIS_URL los contadores son comunes a todas las instancias; sin ella, memoria local.
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis | null) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: 300 },
          { name: 'ip', ttl: 60_000, limit: 1200 },
        ],
        storage: redis ? new RedisThrottlerStorage(redis) : undefined,
      }),
    }),

    // 2. Infraestructura Transversal
    DatabaseModule,
    SharedStoreModule,
    AuditModule,
    RealtimeModule,
    HealthModule,
    MailModule,
    SecurityModule,
    // Observabilidad: opt-in (solo con OBSERVE_APP_KEY y OBSERVE_APP_SECRET). Ver common/config/observe.config.ts
    ...(observeHabilitado() ? [ObserveModule.forRoot(opcionesObserve())] : []),

    // 3. Dominio de Seguridad y Usuarios
    AuthModule,
    UsersApiModule,
    RolesModule,

    // 4. Dominio de Operaciones de Salón, Cocina y POS
    MenuModule,
    TablesModule,
    OrdersModule,
    KdsModule,

    // 5. Dominio Financiero y Analítico
    TransactionsModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Seguridad global y denegada por defecto: primero autenticación (JWT) y luego autorización (cargo/permiso).
    // 1º límite por IP (antes de autenticar), 2º autenticación, 3º autorización, 4º límite por usuario.
    { provide: APP_GUARD, useClass: IpThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // El límite va después de JwtAuthGuard para poder contar por usuario autenticado.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    MaintenanceService,
    // Red de seguridad: ninguna respuesta HTTP incluye columnas internas de auditoría ni secretos.
    { provide: APP_INTERCEPTOR, useClass: ResponseSanitizerInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Identificador de correlación por petición (X-Request-Id)
    consumer.apply(RequestIdMiddleware).forRoutes('*');
    // Protección global contra SQL Injection y XSS en todas las rutas
    consumer.apply(ThreatDetectorMiddleware).forRoutes('*');
    // Protección CSRF para peticiones autenticadas por cookie
    consumer.apply(CsrfOriginMiddleware).forRoutes('*');
  }
}