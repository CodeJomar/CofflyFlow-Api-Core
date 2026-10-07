import { Controller, Post, Get, Patch, Body, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, ContextoPeticion } from './auth.service';
import { TICKET_WS_SEGUNDOS, WsAuthService } from './ws-auth.service';
import type { UsuarioAutenticado } from './session.service';
import { LoginDto } from './dto/login.dto';
import { ActivarCuentaDto, ValidarActivacionDto, RestablecerPasswordDto, SolicitarRecuperacionDto, VerificarOtpDto } from './dto/recovery.dto';
import { CambiarPasswordDto, ActualizarPerfilDto } from './dto/profile.dto';
import { LoginResponseData, SesionUsuarioData, TokenRestablecimientoData } from './dto/auth-response.dto';
import { COOKIE_REFRESCO, establecerCookiesSesion, limpiarCookiesSesion } from './auth-cookies';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';
import { getClientIp } from '../../common/helpers/client-ip';

const UN_MINUTO = 60_000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly wsAuth: WsAuthService,
  ) {}

  @Public()
  // Límite por IP holgado (varias terminales del local comparten IP); el freno real es el contador por correo.
  @Throttle({ default: { ttl: UN_MINUTO, limit: 20 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckStatus<LoginResponseData>> {
    const { respuesta, tokens } = await this.authService.login(dto, this.contexto(req));
    establecerCookiesSesion(res, tokens);
    return new CheckStatus('OK', [new MensajeQuery('AUTH_200', 'Inicio de sesión exitoso.')], '', respuesta);
  }

  @Public()
  @Throttle({ default: { ttl: UN_MINUTO, limit: 30 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refrescar(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CheckStatus<LoginResponseData>> {
    const cookies = req.cookies as Record<string, string> | undefined;
    try {
      const { respuesta, tokens } = await this.authService.refrescar(cookies?.[COOKIE_REFRESCO], this.contexto(req));
      establecerCookiesSesion(res, tokens);
      return new CheckStatus('OK', [new MensajeQuery('AUTH_200', 'Sesión renovada.')], '', respuesta);
    } catch (error) {
      limpiarCookiesSesion(res);
      throw error;
    }
  }

  @Public()
  @Throttle({ default: { ttl: UN_MINUTO, limit: 30 } })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async cerrarSesion(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<CheckStatus<null>> {
    const cookies = req.cookies as Record<string, string> | undefined;
    await this.authService.cerrarSesion(cookies?.[COOKIE_REFRESCO], this.contexto(req));
    limpiarCookiesSesion(res);
    return new CheckStatus('OK', [new MensajeQuery('AUTH_200', 'Sesión cerrada.')]);
  }

  @Authenticated()
  @Get('me')
  async perfil(@CurrentUser('id_usuario') idUsuario: string): Promise<CheckStatus<SesionUsuarioData>> {
    const data = await this.authService.obtenerPerfil(idUsuario);
    return new CheckStatus('OK', [new MensajeQuery('AUTH_200', 'Sesión vigente.')], '', data);
  }

  /** Perfil propio: solo el nombre es editable (el correo y el cargo los administra quien gestiona usuarios). */
  @Authenticated()
  @Throttle({ default: { ttl: UN_MINUTO, limit: 20 } })
  @Patch('perfil')
  async actualizarPerfil(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Body() dto: ActualizarPerfilDto,
    @Req() req: Request,
  ): Promise<CheckStatus<SesionUsuarioData>> {
    const data = await this.authService.actualizarPerfil(usuario, dto, this.contexto(req));
    return new CheckStatus('OK', [new MensajeQuery('AUTH_200', 'Perfil actualizado.')], '', data);
  }

  /** Cambio de contraseña con la actual como verificación. Cierra las demás sesiones y avisa por correo. */
  @Authenticated()
  @Throttle({ default: { ttl: UN_MINUTO, limit: 10 } })
  @Post('cambiar-password')
  @HttpCode(HttpStatus.OK)
  async cambiarPassword(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Body() dto: CambiarPasswordDto,
    @Req() req: Request,
  ): Promise<CheckStatus<null>> {
    await this.authService.cambiarPassword(usuario, dto, this.contexto(req));
    return new CheckStatus('OK', [new MensajeQuery('AUTH_200', 'Contraseña actualizada. Se cerraron tus otras sesiones.')]);
  }

  /** Ticket de 30 s para abrir el WebSocket del KDS (se presenta en el handshake de Socket.IO). */
  @Authenticated()
  @Throttle({ default: { ttl: UN_MINUTO, limit: 30 } })
  @Post('ws-ticket')
  @HttpCode(HttpStatus.OK)
  emitirTicketWs(@CurrentUser() usuario: UsuarioAutenticado): CheckStatus<{ ticket: string; expira_en_segundos: number }> {
    const data = { ticket: this.wsAuth.emitirTicket(usuario), expira_en_segundos: TICKET_WS_SEGUNDOS };
    return new CheckStatus('OK', [new MensajeQuery('AUTH_200', 'Ticket emitido.')], '', data);
  }

  @Public()
  @Throttle({ default: { ttl: UN_MINUTO, limit: 10 } })
  @Post('activar/validar')
  @HttpCode(HttpStatus.OK)
  async validarActivacion(@Body() dto: ValidarActivacionDto): Promise<CheckStatus<{ nombre: string }>> {
    const data = await this.authService.validarActivacion(dto.token);
    return new CheckStatus('OK', [new MensajeQuery('AUTH_200', 'Enlace de activación válido.')], '', data);
  }

  @Public()
  @Throttle({ default: { ttl: UN_MINUTO, limit: 5 } })
  @Post('activar')
  @HttpCode(HttpStatus.OK)
  async activar(@Body() dto: ActivarCuentaDto, @Req() req: Request): Promise<CheckStatus<null>> {
    await this.authService.activarCuenta(dto.token, dto.password, this.contexto(req));
    return new CheckStatus('OK', [new MensajeQuery('AUTH_200', 'Cuenta activada. Ya puedes iniciar sesión.')]);
  }

  @Public()
  @Throttle({ default: { ttl: UN_MINUTO, limit: 3 } })
  @Post('recuperar')
  @HttpCode(HttpStatus.OK)
  recuperar(@Body() dto: SolicitarRecuperacionDto, @Req() req: Request): CheckStatus<null> {
    this.authService.solicitarRecuperacion(dto.email, this.contexto(req));
    // Respuesta genérica: no revela si el correo existe (AUTH-008).
    return new CheckStatus('OK', [
      new MensajeQuery('AUTH_200', 'Si el correo está registrado, recibirás un código de verificación.'),
    ]);
  }

  @Public()
  @Throttle({ default: { ttl: UN_MINUTO, limit: 5 } })
  @Post('verificar-otp')
  @HttpCode(HttpStatus.OK)
  async verificarOtp(@Body() dto: VerificarOtpDto, @Req() req: Request): Promise<CheckStatus<TokenRestablecimientoData>> {
    const data = await this.authService.verificarOtp(dto.email, dto.codigo, this.contexto(req));
    return new CheckStatus('OK', [new MensajeQuery('AUTH_200', 'Código verificado.')], '', data);
  }

  @Public()
  @Throttle({ default: { ttl: UN_MINUTO, limit: 5 } })
  @Post('restablecer-password')
  @HttpCode(HttpStatus.OK)
  async restablecer(@Body() dto: RestablecerPasswordDto, @Req() req: Request): Promise<CheckStatus<null>> {
    await this.authService.restablecerPassword(dto.token, dto.nueva_password, this.contexto(req));
    return new CheckStatus('OK', [new MensajeQuery('AUTH_200', 'Contraseña actualizada. Inicia sesión con la nueva contraseña.')]);
  }

  private contexto(req: Request): ContextoPeticion {
    return { ip: req.ip ?? getClientIp(req), userAgent: req.headers['user-agent'] ?? null };
  }
}

