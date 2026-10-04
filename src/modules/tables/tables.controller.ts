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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { ChangeTableStatusDto } from './dto/change-table-status.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OneQuery } from '../../core/dto/one-query.dto';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';

@Controller('tables')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Post()
  @Roles('Admin')
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
  async listarMesas(@Query('estado') estado?: string): Promise<CheckStatus<unknown>> {
    const planoSalond = await this.tablesService.listarMesas(estado);
    return new CheckStatus(
      'OK',
      [new MensajeQuery('TABLE_200', 'Plano de mesas recuperado con éxito.')],
      '',
      planoSalond,
    );
  }

  @Get(':id')
  async obtenerPorId(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OneQuery<unknown>> {
    const mesa = await this.tablesService.obtenerPorId(id);
    return new OneQuery(mesa, 'OK', [new MensajeQuery('TABLE_200', 'Detalle de mesa recuperado.')]);
  }

  @Patch(':id')
  @Roles('Admin')
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
  @Roles('Admin')
  async eliminarMesa(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<CheckStatus<null>> {
    await this.tablesService.eliminarMesa(id, idOperador);
    return new CheckStatus('OK', [new MensajeQuery('TABLE_200', 'Mesa retirada del plano.')], '', null);
  }
}