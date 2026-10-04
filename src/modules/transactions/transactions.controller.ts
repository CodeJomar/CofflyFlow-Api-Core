import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { AperturaTurnoDto } from './dto/apertura-turno.dto';
import { CierreTurnoDto } from './dto/cierre-turno.dto';
import { MovimientoCajaDto } from './dto/movimiento-caja.dto';
import { CobroPedidoDto } from './dto/cobro-pedido.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OneQuery } from '../../core/dto/one-query.dto';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';

@Controller('transactions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  // =========================================================================
  // CONTROL DE TURNOS DE CAJA
  // =========================================================================

  @Post('turnos/apertura')
  @HttpCode(HttpStatus.CREATED)
  async abrirTurno(
    @Body() dto: AperturaTurnoDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const turno = await this.transactionsService.abrirTurno(dto, idOperador);
    return new OneQuery(turno, 'CREATED', [
      new MensajeQuery('TURNO_201', 'Turno de caja aperturado con éxito.'),
    ]);
  }

  @Get('turnos/actual')
  async obtenerTurnoActual(
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<CheckStatus<unknown>> {
    const turno = await this.transactionsService.obtenerTurnoActual(idOperador);
    return new CheckStatus(
      'OK',
      [new MensajeQuery('TURNO_200', 'Información del turno actual.')],
      '',
      turno,
    );
  }

  @Post('turnos/:id/cierre')
  async cerrarTurno(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CierreTurnoDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const turno = await this.transactionsService.cerrarTurno(id, dto, idOperador);
    const mensaje =
      turno.estado === 'descuadre'
        ? `Turno cerrado con descuadre de S/ ${turno.diferencia}.`
        : 'Turno cerrado con arqueo exacto.';
    return new OneQuery(turno, 'OK', [new MensajeQuery('TURNO_200', mensaje)]);
  }

  // =========================================================================
  // MOVIMIENTOS EXTRAORDINARIOS DE CAJA
  // =========================================================================

  @Post('movimientos')
  @HttpCode(HttpStatus.CREATED)
  async registrarMovimiento(
    @Body() dto: MovimientoCajaDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const movimiento = await this.transactionsService.registrarMovimiento(dto, idOperador);
    return new OneQuery(movimiento, 'CREATED', [
      new MensajeQuery('MOV_201', 'Movimiento de caja registrado.'),
    ]);
  }

  // =========================================================================
  // COBRO DE COMANDA (POS CAJA)
  // =========================================================================

  @Post('cobrar')
  @HttpCode(HttpStatus.CREATED)
  async cobrarPedido(
    @Body() dto: CobroPedidoDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const cobro = await this.transactionsService.cobrarPedido(dto, idOperador);
    return new OneQuery(cobro, 'CREATED', [
      new MensajeQuery('PAGO_201', 'Pago procesado exitosamente y mesa liberada para limpieza.'),
    ]);
  }

  @Get('historial')
  async listarHistorial(
    @Query('id_turno') idTurno?: string,
  ): Promise<CheckStatus<unknown>> {
    const historial = await this.transactionsService.listarHistorial(idTurno);
    return new CheckStatus(
      'OK',
      [new MensajeQuery('HIST_200', 'Historial de transacciones recuperado.')],
      '',
      historial,
    );
  }
}