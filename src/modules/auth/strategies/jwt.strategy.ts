import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string;
  email: string;
  id_rol: string;
  rol_nombre: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET no está definido en las variables de entorno.');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub || !payload.id_rol) {
      throw new UnauthorizedException('Token inválido: estructura de identidad incompleta.');
    }

    // Retorna el objeto que se inyecta en req.user
    return {
      id_usuario: payload.sub,
      email: payload.email,
      id_rol: payload.id_rol,
      rol_nombre: payload.rol_nombre,
    };
  }
}