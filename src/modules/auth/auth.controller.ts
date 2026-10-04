import { Controller, Post, Body, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';
import { AuthResponseData } from './dto/auth-response.dto';
import { getClientIp } from '../../common/helpers/client-ip';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<CheckStatus<AuthResponseData>> {
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'] || null;

    const data = await this.authService.login(dto, ip, userAgent);

    return new CheckStatus(
      'OK',
      [new MensajeQuery('AUTH_200', 'Inicio de sesión exitoso.')],
      '',
      data,
    );
  }
}