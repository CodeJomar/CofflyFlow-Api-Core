import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { databaseProviders, DRIZZLE, PG_CLIENT, type PgClient } from './database.provider';

@Global()
@Module({
  providers: [...databaseProviders],
  exports: [DRIZZLE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_CLIENT) private readonly cliente: PgClient) {}

  /** Cierra el pool al apagar (espera hasta 5 s a las consultas en curso) para no dejar conexiones colgadas en el pooler. */
  async onApplicationShutdown(): Promise<void> {
    await this.cliente.end({ timeout: 5 });
  }
}
