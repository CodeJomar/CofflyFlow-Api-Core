import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ModifiersService } from './modifiers.service';
import {
  AsignarGruposDto,
  CreateGrupoDto,
  CreateOpcionDto,
  ToggleOpcionDto,
  UpdateGrupoDto,
  UpdateOpcionDto,
} from './dto/modifiers.dto';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { MODULO, ACCION } from '../../common/security/permission-matrix';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OneQuery } from '../../core/dto/one-query.dto';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';

const uuid = () => new ParseUUIDPipe({ version: '4' });

/**
 * Modificadores del menú (grupos y opciones) y su asignación a productos.
 * Mismo módulo de permisos que el resto del menú: MENU:LEER / CREAR / EDITAR / ELIMINAR / DISPONIBILIDAD.
 */
@Controller('menu')
export class ModifiersController {
  constructor(private readonly modifiers: ModifiersService) {}

  // ---- Grupos ---------------------------------------------------------------------------------------------------

  @Get('grupos-modificadores')
  @RequirePermission(MODULO.MENU, ACCION.LEER)
  async listarGrupos(): Promise<CheckStatus<unknown>> {
    const grupos = await this.modifiers.listarGrupos();
    return new CheckStatus('OK', [new MensajeQuery('MOD_200', 'Grupos de modificadores recuperados.')], '', grupos);
  }

  @Get('grupos-modificadores/:id')
  @RequirePermission(MODULO.MENU, ACCION.LEER)
  async obtenerGrupo(@Param('id', uuid()) id: string): Promise<OneQuery<unknown>> {
    const grupo = await this.modifiers.obtenerGrupo(id);
    return new OneQuery(grupo, 'OK', [new MensajeQuery('MOD_200', 'Grupo de modificadores recuperado.')]);
  }

  @Post('grupos-modificadores')
  @RequirePermission(MODULO.MENU, ACCION.CREAR)
  @HttpCode(HttpStatus.CREATED)
  async crearGrupo(@Body() dto: CreateGrupoDto, @CurrentUser('id_usuario') idOperador: string): Promise<OneQuery<unknown>> {
    const grupo = await this.modifiers.crearGrupo(dto, idOperador);
    return new OneQuery(grupo, 'CREATED', [new MensajeQuery('MOD_201', 'Grupo de modificadores creado.')]);
  }

  @Patch('grupos-modificadores/:id')
  @RequirePermission(MODULO.MENU, ACCION.EDITAR)
  async actualizarGrupo(
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateGrupoDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const grupo = await this.modifiers.actualizarGrupo(id, dto, idOperador);
    return new OneQuery(grupo, 'OK', [new MensajeQuery('MOD_200', 'Grupo de modificadores actualizado.')]);
  }

  @Delete('grupos-modificadores/:id')
  @RequirePermission(MODULO.MENU, ACCION.ELIMINAR)
  async eliminarGrupo(@Param('id', uuid()) id: string, @CurrentUser('id_usuario') idOperador: string): Promise<CheckStatus<null>> {
    await this.modifiers.eliminarGrupo(id, idOperador);
    return new CheckStatus('OK', [new MensajeQuery('MOD_200', 'Grupo de modificadores eliminado.')], '', null);
  }

  // ---- Opciones -------------------------------------------------------------------------------------------------

  @Post('grupos-modificadores/:id/opciones')
  @RequirePermission(MODULO.MENU, ACCION.CREAR)
  @HttpCode(HttpStatus.CREATED)
  async crearOpcion(
    @Param('id', uuid()) id: string,
    @Body() dto: CreateOpcionDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const grupo = await this.modifiers.crearOpcion(id, dto, idOperador);
    return new OneQuery(grupo, 'CREATED', [new MensajeQuery('MOD_201', 'Opción agregada al grupo.')]);
  }

  @Patch('opciones-modificador/:id')
  @RequirePermission(MODULO.MENU, ACCION.EDITAR)
  async actualizarOpcion(
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateOpcionDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const grupo = await this.modifiers.actualizarOpcion(id, dto, idOperador);
    return new OneQuery(grupo, 'OK', [new MensajeQuery('MOD_200', 'Opción actualizada.')]);
  }

  /** Toque rápido para marcar una opción como disponible o agotada (misma acción táctil que el producto). */
  @Patch('opciones-modificador/:id/toggle-disponibilidad')
  @RequirePermission(MODULO.MENU, ACCION.DISPONIBILIDAD)
  async conmutarDisponibilidad(
    @Param('id', uuid()) id: string,
    @Body() dto: ToggleOpcionDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const grupo = await this.modifiers.conmutarDisponibilidadOpcion(id, dto.disponible, idOperador);
    return new OneQuery(grupo, 'OK', [new MensajeQuery('MOD_200', 'Disponibilidad de la opción actualizada.')]);
  }

  @Delete('opciones-modificador/:id')
  @RequirePermission(MODULO.MENU, ACCION.ELIMINAR)
  async eliminarOpcion(@Param('id', uuid()) id: string, @CurrentUser('id_usuario') idOperador: string): Promise<OneQuery<unknown>> {
    const grupo = await this.modifiers.eliminarOpcion(id, idOperador);
    return new OneQuery(grupo, 'OK', [new MensajeQuery('MOD_200', 'Opción eliminada.')]);
  }

  // ---- Asignación a productos -----------------------------------------------------------------------------------

  /** Define el conjunto completo de grupos de modificadores de un producto. */
  @Put('productos/:id/grupos-modificadores')
  @RequirePermission(MODULO.MENU, ACCION.EDITAR)
  async asignarGrupos(
    @Param('id', uuid()) id: string,
    @Body() dto: AsignarGruposDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<CheckStatus<unknown>> {
    const grupos = await this.modifiers.asignarGruposAProducto(id, dto, idOperador);
    return new CheckStatus('OK', [new MensajeQuery('MOD_200', 'Modificadores del producto actualizados.')], '', grupos);
  }
}
