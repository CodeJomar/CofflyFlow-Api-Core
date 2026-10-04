import { Global, Module } from '@nestjs/common';
import { databaseProviders, DRIZZLE } from './database.provider';

@Global()
@Module({
  providers: [...databaseProviders],
  exports: [DRIZZLE],
})
export class DatabaseModule {}