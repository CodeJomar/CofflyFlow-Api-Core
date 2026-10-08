import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { UsersService, UsuarioSeguro } from './users.service';
import { BajaUserDto } from './dto/baja-user.dto';
import { AuthService } from '../auth/auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginationQueryDto } from '../../core/dto/pagination-query.dto';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { MODULO, ACCION } from '../../common/security/permission-matrix';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OneQuery } from '../../core/dto/one-query.dto';
import { DataQuery } from '../../core/dto/data-query.dto';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  @RequirePermission(MODULO.USERS, ACCION.CREAR)
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
  @RequirePermission(MODULO.USERS, ACCION.EDITAR)
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
  @RequirePermission(MODULO.USERS, ACCION.LEER)
  async listarCargos(): Promise<CheckStatus<{ id_rol: string; nombre: string; descripcion: string | null }[]>> {
    const cargos = await this.usersService.listarCargos();
    return new CheckStatus('OK', [new MensajeQuery('USER_200', 'Cargos recuperados.')], '', cargos);
  }

  @Get()
  @RequirePermission(MODULO.USERS, ACCION.LEER)
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
  @RequirePermission(MODULO.USERS, ACCION.LEER)
  async obtenerPorId(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OneQuery<UsuarioSeguro>> {
    const usuario = await this.usersService.obtenerPorId(id);
    return new OneQuery(usuario, 'OK', [
      new MensajeQuery('USER_200', 'Detalle de usuario recuperado.'),
    ]);
  }

  @Patch(':id')
  @RequirePermission(MODULO.USERS, ACCION.EDITAR)
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
  @RequirePermission(MODULO.USERS, ACCION.ELIMINAR)
  async eliminar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser('id_usuario') idOperador: string,
    @Body() dto: BajaUserDto,
  ): Promise<CheckStatus<null>> {
    await this.usersService.eliminarUsuario(id, idOperador, dto?.motivo);
    return new CheckStatus('OK', [
      new MensajeQuery('USER_200', 'Usuario dado de baja exitosamente.'),
    ]);
  }

  private contexto(req: Request) {
    return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
  }
}
