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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { ListMesasQueryDto } from './dto/list-mesas-query.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { ChangeTableStatusDto } from './dto/change-table-status.dto';
import { RenameAreaDto } from './dto/rename-area.dto';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { MODULO, ACCION } from '../../common/security/permission-matrix';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OneQuery } from '../../core/dto/one-query.dto';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';

@Controller('tables')
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Post()
  @RequirePermission(MODULO.TABLES, ACCION.CREAR)
  @HttpCode(HttpStatus.CREATED)
  async crearMesa(
    @Body() dto: CreateTableDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const mesa = await this.tablesService.crearMesa(dto, idOperador);
    return new OneQuery(mesa, 'CREATED', [
      new MensajeQuery('TABLE_201', 'Mesa registrada exitosamente en el plano.'),
    ]);
  }

  @Get()
  @RequirePermission(MODULO.TABLES, ACCION.LEER)
  async listarMesas(@Query() filtros: ListMesasQueryDto): Promise<CheckStatus<unknown>> {
    const planoSalond = await this.tablesService.listarMesas(filtros);
    return new CheckStatus(
      'OK',
      [new MensajeQuery('TABLE_200', 'Plano de mesas recuperado con éxito.')],
      '',
      planoSalond,
    );
  }

  /** Áreas del local (texto libre de cada mesa) con su número de mesas. */
  @Get('areas')
  @RequirePermission(MODULO.TABLES, ACCION.LEER)
  async listarAreas(): Promise<CheckStatus<unknown>> {
    const areas = await this.tablesService.listarAreas();
    return new CheckStatus('OK', [new MensajeQuery('TABLE_200', 'Áreas recuperadas.')], '', areas);
  }

  /** Renombra un área en todas sus mesas a la vez. */
  @Patch('areas')
  @RequirePermission(MODULO.TABLES, ACCION.EDITAR)
  async renombrarArea(
    @Body() dto: RenameAreaDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const resultado = await this.tablesService.renombrarArea(dto.actual, dto.nuevo, idOperador);
    return new OneQuery(resultado, 'OK', [new MensajeQuery('TABLE_200', 'Área renombrada en todas sus mesas.')]);
  }

  @Get(':id')
  @RequirePermission(MODULO.TABLES, ACCION.LEER)
  async obtenerPorId(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OneQuery<unknown>> {
    const mesa = await this.tablesService.obtenerPorId(id);
    return new OneQuery(mesa, 'OK', [new MensajeQuery('TABLE_200', 'Detalle de mesa recuperado.')]);
  }

  @Patch(':id')
  @RequirePermission(MODULO.TABLES, ACCION.EDITAR)
  async actualizarMesa(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateTableDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const mesa = await this.tablesService.actualizarMesa(id, dto, idOperador);
    return new OneQuery(mesa, 'OK', [
      new MensajeQuery('TABLE_200', 'Configuración de mesa actualizada.'),
    ]);
  }

  /**
   * Cambio de estado rápido en el salón (Meseros, Cajeros y Baristas)
   */
  @Patch(':id/estado')
  @RequirePermission(MODULO.TABLES, ACCION.CAMBIAR_ESTADO)
  async cambiarEstado(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ChangeTableStatusDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const mesa = await this.tablesService.cambiarEstadoMesa(id, dto.estado, idOperador);
    return new OneQuery(mesa, 'OK', [
      new MensajeQuery('TABLE_200', `Estado de mesa cambiado a ${mesa.estado}.`),
    ]);
  }

  @Delete(':id')
  @RequirePermission(MODULO.TABLES, ACCION.ELIMINAR)
  async eliminarMesa(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<CheckStatus<null>> {
    await this.tablesService.eliminarMesa(id, idOperador);
    return new CheckStatus('OK', [new MensajeQuery('TABLE_200', 'Mesa retirada del plano.')], '', null);
  }
}