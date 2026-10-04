import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './common/database/database.module';
import { AuditModule } from './common/audit/audit.module';
import { HealthModule } from './common/health/health.module';
import { ThreatDetectorMiddleware } from './common/middleware/threat-detector.middleware';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    AuditModule,
    HealthModule,
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'api-core',
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ThreatDetectorMiddleware).forRoutes('*');
  }
}
