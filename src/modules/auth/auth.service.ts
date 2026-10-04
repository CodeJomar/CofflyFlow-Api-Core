import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { AuthResponseData } from './dto/auth-response.dto';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { sesiones_usuario } from '../../common/database/schema/users.schema';
import { DateUtils } from '../../core/utils/date.utils';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  async login(
    dto: LoginDto,
    ip: string | null,
    userAgent: string | null,
  ): Promise<AuthResponseData> {
    // 1. Delegar a UsersService la búsqueda por correo
    const usuario = await this.usersService.buscarPorEmailParaAuth(dto.email);

    if (!usuario) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    // 2. Control de estado y mitigación de fuerza bruta (OWASP A07)
    if (usuario.estado === 'bloqueado') {
      if (usuario.bloqueado_hasta && !DateUtils.haExpirado(new Date(usuario.bloqueado_hasta))) {
        throw new ForbiddenException(
          'La cuenta se encuentra temporalmente bloqueada por múltiples intentos fallidos. Intente más tarde.',
        );
      }
      // Si el tiempo de bloqueo ya expiró, desbloqueamos la cuenta
      await this.usersService.resetearFallosLogin(usuario.id_usuario);
    }

    if (usuario.estado === 'inactivo') {
      throw new ForbiddenException('La cuenta de usuario está inactiva. Contacte al administrador.');
    }

    // 3. Comparación segura del hash de contraseña con bcrypt
    const passwordValido = await bcrypt.compare(dto.password, usuario.password_hash);

    if (!passwordValido) {
      const maxIntentos = Number(this.configService.get('MAX_LOGIN_ATTEMPTS')) || 5;
      const minutosBloqueo = Number(this.configService.get('ACCOUNT_LOCKOUT_MINUTES')) || 15;

      // Llama al método exacto de tu UsersService
      await this.usersService.registrarFalloLogin(usuario.id_usuario, maxIntentos, minutosBloqueo);
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    // 4. Si la contraseña es correcta, reseteamos el contador de fallos y actualizamos último login
    await this.usersService.resetearFallosLogin(usuario.id_usuario);

    // 5. Generar Access Token (JWT con payload ligero)
    const payload = {
      sub: usuario.id_usuario,
      email: usuario.email,
      id_rol: usuario.id_rol,
      rol_nombre: usuario.rol_nombre,
    };

    const tokenAcceso = this.jwtService.sign(payload);

    // 6. Generar Refresh Token aleatorio y persistir su hash SHA-256 en sesiones_usuario
    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const expiraEnDias = 7;
    const fechaExpiracionRefresh = new Date();
    fechaExpiracionRefresh.setDate(fechaExpiracionRefresh.getDate() + expiraEnDias);

    await this.db.insert(sesiones_usuario).values({
      id_usuario: usuario.id_usuario,
      refresh_token_hash: refreshTokenHash,
      expira_en: fechaExpiracionRefresh,
      ip_origen: ip ?? null,
      user_agent: userAgent ?? null,
      nombre_dispositivo: 'Web / POS Terminal',
    });

    // 7. Retornar payload en snake_case y español
    return {
      token_acceso: tokenAcceso,
      token_refresco: rawRefreshToken,
      tipo_token: 'Bearer',
      expira_en_segundos: 300, // 5 minutos (configurado en .env)
      usuario: {
        id_usuario: usuario.id_usuario,
        nombre: usuario.nombre,
        email: usuario.email,
        id_rol: usuario.id_rol,
        rol_nombre: usuario.rol_nombre || 'Sin Rol',
      },
    };
  }
}