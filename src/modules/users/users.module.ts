import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

/** Servicio de usuarios (sin endpoints): lo consumen Auth y la API de usuarios. Sin dependencias circulares. */
@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
