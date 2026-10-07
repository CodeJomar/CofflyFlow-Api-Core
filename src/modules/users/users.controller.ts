import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { UsersService, UsuarioSeguro } from './users.service';
import { AuthService } from '../auth/auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginationQueryDto } from '../../core/dto/pagination-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OneQuery } from '../../core/dto/one-query.dto';
import { DataQuery } from '../../core/dto/data-query.dto';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  @Roles('OWNER')
  async crear(
    @Body() dto: CreateUserDto,
    @CurrentUser('id_usuario') idOperador: string,
    @Req() req: Request,
  ): Promise<OneQuery<UsuarioSeguro>> {
    const usuario = await this.usersService.crearUsuario(dto, idOperador);
    const mensajes = [new MensajeQuery('USER_201', 'Empleado registrado. Se envió un correo para activar su cuenta.')];

    try {
      await this.authService.enviarActivacion(usuario.id_usuario, this.contexto(req), idOperador);
    } catch {
      // La cuenta ya existe: el envío fallido se reintenta con POST /users/:id/reenviar-activacion.
      mensajes[0] = new MensajeQuery('USER_201', 'Empleado registrado, pero no se pudo enviar el correo de activación. Reenvíalo desde el detalle del empleado.');
    }

    return new OneQuery(usuario, 'CREATED', mensajes);
  }

  @Post(':id/reenviar-activacion')
  @Roles('OWNER')
  async reenviarActivacion(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser('id_usuario') idOperador: string,
    @Req() req: Request,
  ): Promise<CheckStatus<null>> {
    await this.authService.enviarActivacion(id, this.contexto(req), idOperador);
    return new CheckStatus('OK', [new MensajeQuery('USER_200', 'Correo de activación reenviado.')]);
  }

  /** Cargos disponibles para el selector del formulario de alta de empleado. */
  @Get('cargos')
  @Roles('OWNER')
  async listarCargos(): Promise<CheckStatus<{ id_rol: string; nombre: string; descripcion: string | null }[]>> {
    const cargos = await this.usersService.listarCargos();
    return new CheckStatus('OK', [new MensajeQuery('USER_200', 'Cargos recuperados.')], '', cargos);
  }

  @Get()
  @Roles('OWNER')
  async listar(@Query() query: PaginationQueryDto): Promise<DataQuery<UsuarioSeguro>> {
    const { items, total } = await this.usersService.listarUsuarios(query);
    return new DataQuery(
      items,
      total,
      Number(query.pagina) || 1,
      Number(query.limite) || 10,
      'OK',
      [new MensajeQuery('USER_200', 'Listado de usuarios recuperado.')],
    );
  }

  @Get(':id')
  @Roles('OWNER')
  async obtenerPorId(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OneQuery<UsuarioSeguro>> {
    const usuario = await this.usersService.obtenerPorId(id);
    return new OneQuery(usuario, 'OK', [
      new MensajeQuery('USER_200', 'Detalle de usuario recuperado.'),
    ]);
  }

  @Patch(':id')
  @Roles('OWNER')
  async actualizar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<UsuarioSeguro>> {
    const usuario = await this.usersService.actualizarUsuario(id, dto, idOperador);
    return new OneQuery(usuario, 'OK', [
      new MensajeQuery('USER_200', 'Usuario actualizado correctamente.'),
    ]);
  }

  @Delete(':id')
  @Roles('OWNER')
  async eliminar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<CheckStatus<null>> {
    await this.usersService.eliminarUsuario(id, idOperador);
    return new CheckStatus('OK', [
      new MensajeQuery('USER_200', 'Usuario dado de baja exitosamente.'),
    ]);
  }

  private contexto(req: Request) {
    return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
  }
}
