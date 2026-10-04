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
} from '@nestjs/common';
import { UsersService, UsuarioSeguro } from './users.service';
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
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles('Admin')
  async crear(
    @Body() dto: CreateUserDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<UsuarioSeguro>> {
    const usuario = await this.usersService.crearUsuario(dto, idOperador);
    return new OneQuery(
      usuario,
      'CREATED',
      [new MensajeQuery('USER_201', 'Empleado registrado exitosamente.')],
    );
  }

  @Get()
  @Roles('Admin')
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
  @Roles('Admin')
  async obtenerPorId(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OneQuery<UsuarioSeguro>> {
    const usuario = await this.usersService.obtenerPorId(id);
    return new OneQuery(usuario, 'OK', [
      new MensajeQuery('USER_200', 'Detalle de usuario recuperado.'),
    ]);
  }

  @Patch(':id')
  @Roles('Admin')
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
  @Roles('Admin')
  async eliminar(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<CheckStatus<null>> {
    await this.usersService.eliminarUsuario(id, idOperador);
    return new CheckStatus('OK', [
      new MensajeQuery('USER_200', 'Usuario dado de baja exitosamente.'),
    ]);
  }
}