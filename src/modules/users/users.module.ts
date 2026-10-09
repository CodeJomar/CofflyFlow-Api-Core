import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { PiiMigrationService } from './pii-migration.service';
import { PiiCipherService } from '../../common/security/pii-cipher';

/** Servicio de usuarios (sin endpoints): lo consumen Auth y la API de usuarios. Sin dependencias circulares. */
@Module({
  providers: [UsersService, UsersRepository, PiiCipherService, PiiMigrationService],
  exports: [UsersService],
})
export class UsersModule {}
