import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRolDto, ReemplazarPermisosDto, UpdateRolDto } from './dto/roles.dto';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { MODULO, ACCION } from '../../common/security/permission-matrix';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OneQuery } from '../../core/dto/one-query.dto';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';
import type { UsuarioAutenticado } from '../auth/session.service';

const uuid = () => new ParseUUIDPipe({ version: '4' });

/**
 * Administración de roles y permisos. Por defecto solo OWNER tiene el módulo ROLES; se puede delegar con
 * permisos ROLES:* a un cargo, pero un delegado no puede conceder más de lo que él mismo tiene.
 */
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission(MODULO.ROLES, ACCION.LEER)
  async listar(): Promise<CheckStatus<unknown>> {
    const data = await this.roles.listar();
    return new CheckStatus('OK', [new MensajeQuery('ROL_200', 'Roles recuperados.')], '', data);
  }

  /** Catálogo de permisos disponibles (módulos y acciones) para pintar la pantalla de permisos. */
  @Get('catalogo-permisos')
  @RequirePermission(MODULO.ROLES, ACCION.LEER)
  catalogo(): CheckStatus<unknown> {
    return new CheckStatus('OK', [new MensajeQuery('ROL_200', 'Catálogo de permisos recuperado.')], '', this.roles.catalogoPermisos());
  }

  @Get(':id')
  @RequirePermission(MODULO.ROLES, ACCION.LEER)
  async obtener(@Param('id', uuid()) id: string): Promise<OneQuery<unknown>> {
    return new OneQuery(await this.roles.obtener(id), 'OK', [new MensajeQuery('ROL_200', 'Rol recuperado.')]);
  }

  @Post()
  @RequirePermission(MODULO.ROLES, ACCION.CREAR)
  @HttpCode(HttpStatus.CREATED)
  async crear(@Body() dto: CreateRolDto, @CurrentUser() actor: UsuarioAutenticado): Promise<OneQuery<unknown>> {
    return new OneQuery(await this.roles.crear(dto, actor), 'CREATED', [new MensajeQuery('ROL_201', 'Rol creado.')]);
  }

  @Patch(':id')
  @RequirePermission(MODULO.ROLES, ACCION.EDITAR)
  async actualizar(
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateRolDto,
    @CurrentUser() actor: UsuarioAutenticado,
  ): Promise<OneQuery<unknown>> {
    return new OneQuery(await this.roles.actualizar(id, dto, actor), 'OK', [new MensajeQuery('ROL_200', 'Rol actualizado.')]);
  }

  /** Define el conjunto completo de permisos del rol. Surte efecto de inmediato. */
  @Put(':id/permisos')
  @RequirePermission(MODULO.ROLES, ACCION.EDITAR)
  async reemplazarPermisos(
    @Param('id', uuid()) id: string,
    @Body() dto: ReemplazarPermisosDto,
    @CurrentUser() actor: UsuarioAutenticado,
  ): Promise<OneQuery<unknown>> {
    return new OneQuery(await this.roles.reemplazarPermisos(id, dto.permisos, actor), 'OK', [
      new MensajeQuery('ROL_200', 'Permisos del rol actualizados.'),
    ]);
  }

  @Delete(':id')
  @RequirePermission(MODULO.ROLES, ACCION.ELIMINAR)
  async eliminar(@Param('id', uuid()) id: string, @CurrentUser() actor: UsuarioAutenticado): Promise<CheckStatus<null>> {
    await this.roles.eliminar(id, actor);
    return new CheckStatus('OK', [new MensajeQuery('ROL_200', 'Rol eliminado.')], '', null);
  }
}
