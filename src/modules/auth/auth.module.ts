import { Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LoginAttemptsService } from './login-attempts.service';
import { SessionService } from './session.service';
import { WsAuthService } from './ws-auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: (configService.get<string>('JWT_EXPIRATION') || '15m') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LoginAttemptsService, SessionService, WsAuthService],
  exports: [AuthService, JwtModule, PassportModule, SessionService, WsAuthService],
})
export class AuthModule {}