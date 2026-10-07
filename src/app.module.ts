import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { ThrottlerModule } from '@nestjs/throttler';

// Controladores y Servicios Base
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Infraestructura y Seguridad Core
import { DatabaseModule } from './common/database/database.module';
import { AuditModule } from './common/audit/audit.module';
import { HealthModule } from './common/health/health.module';
import { MailModule } from './common/mail/mail.module';
import { ThreatDetectorMiddleware } from './common/middleware/threat-detector.middleware';
import { CsrfOriginMiddleware } from './common/middleware/csrf-origin.middleware';

// Módulos de Negocio Coffly Flow
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
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
    }),

    // Límite por defecto (60 req/min por IP). Solo aplica donde se use ThrottlerGuard (p. ej. /auth).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),

    // 2. Infraestructura Transversal
    DatabaseModule,
    AuditModule,
    HealthModule,
    MailModule,
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY || 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET || 'YOUR_APP_SECRET',
      serviceId: 'api-core',
    }),

    // 3. Dominio de Seguridad y Usuarios
    AuthModule,
    UsersModule,

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
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Protección global contra SQL Injection y XSS en todas las rutas
    consumer.apply(ThreatDetectorMiddleware).forRoutes('*');
    // Protección CSRF para peticiones autenticadas por cookie
    consumer.apply(CsrfOriginMiddleware).forRoutes('*');
  }
}