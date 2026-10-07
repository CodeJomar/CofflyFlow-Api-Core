import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ConfigService } from '@nestjs/config';
import * as schema from './schema';

export const DRIZZLE = 'DRIZZLE_CONNECTION';
export const PG_CLIENT = 'PG_CLIENT';
export type DrizzleDb = PostgresJsDatabase<typeof schema>;
export type PgClient = ReturnType<typeof postgres>;

export const databaseProviders = [
  {
    provide: PG_CLIENT,
    inject: [ConfigService],
    useFactory: (configService: ConfigService): PgClient => {
      const connectionString = configService.get<string>('DATABASE_URL');
      if (!connectionString) {
        throw new Error('DATABASE_URL no está definida en las variables de entorno.');
      }

      // Limitamos el pool de conexiones y desactivamos prepared statements para compatibilidad con PgBouncer/Supabase Pooler (puerto 6543)
      return postgres(connectionString, {
        max: Number(configService.get('DB_MAX_CONNECTIONS')) || 10,
        idle_timeout: Number(configService.get('DB_IDLE_TIMEOUT')) || 30,
        ssl: configService.get('DB_SSL') === 'true' ? 'require' : false,
        prepare: false, // CRÍTICO: Obligatorio para el Transaction Pooler (puerto 6543) de Supabase
      });
    },
  },
  {
    provide: DRIZZLE,
    inject: [PG_CLIENT],
    // Pasamos el schema para tener inferencia de tipos completa en los servicios
    useFactory: (client: PgClient): DrizzleDb => drizzle(client, { schema }),
  },
];
