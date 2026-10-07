import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersModule } from './users.module';
import { AuthModule } from '../auth/auth.module';

/** Endpoints /users. Vive aparte de UsersModule porque orquesta Usuarios y Auth (activación por correo). */
@Module({
  imports: [UsersModule, AuthModule],
  controllers: [UsersController],
})
export class UsersApiModule {}
