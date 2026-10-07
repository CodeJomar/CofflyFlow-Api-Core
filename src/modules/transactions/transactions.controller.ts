import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  Res,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { TransactionsService } from './transactions.service';
import { AperturaTurnoDto } from './dto/apertura-turno.dto';
import { CierreTurnoDto } from './dto/cierre-turno.dto';
import { MovimientoCajaDto } from './dto/movimiento-caja.dto';
import { CobroPedidoDto } from './dto/cobro-pedido.dto';
import { AjusteCajaDto } from './dto/ajuste-caja.dto';
import { DevolucionDto } from './dto/devolucion.dto';
import { validarClaveIdempotencia } from '../../common/helpers/idempotency-key';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { UsuarioAutenticado } from '../auth/session.service';
import { OneQuery } from '../../core/dto/one-query.dto';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { MODULO, ACCION } from '../../common/security/permission-matrix';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  // =========================================================================
  // CONTROL DE TURNOS DE CAJA
  // =========================================================================

  @Post('turnos/apertura')
  @RequirePermission(MODULO.TRANSACTIONS, ACCION.ARQUEAR)
  @HttpCode(HttpStatus.CREATED)
  async abrirTurno(
    @Body() dto: AperturaTurnoDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<OneQuery<unknown>> {
    const turno = await this.transactionsService.abrirTurno(dto, usuario);
    return new OneQuery(turno, 'CREATED', [
      new MensajeQuery('TURNO_201', 'Turno de caja aperturado con éxito.'),
    ]);
  }

  @Get('turnos/actual')
  @RequirePermission(MODULO.TRANSACTIONS, ACCION.LEER)
  async obtenerTurnoActual(): Promise<CheckStatus<unknown>> {
    const turno = await this.transactionsService.obtenerTurnoActual();
    return new CheckStatus(
      'OK',
      [new MensajeQuery('TURNO_200', 'Información del turno actual.')],
      '',
      turno,
    );
  }

  @Post('turnos/:id/cierre')
  @RequirePermission(MODULO.TRANSACTIONS, ACCION.ARQUEAR)
  async cerrarTurno(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CierreTurnoDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<OneQuery<unknown>> {
    const turno = await this.transactionsService.cerrarTurno(id, dto, usuario);
    const mensaje =
      turno.estado === 'descuadre'
        ? `Turno cerrado con descuadre de S/ ${turno.diferencia}.`
        : 'Turno cerrado con arqueo exacto.';
    return new OneQuery(turno, 'OK', [new MensajeQuery('TURNO_200', mensaje)]);
  }

  /** TRX-008: corrección auditable sobre un turno ya cerrado. Por defecto solo OWNER (TRANSACTIONS:AJUSTAR). */
  @Post('turnos/:id/ajustes')
  @RequirePermission(MODULO.TRANSACTIONS, ACCION.AJUSTAR)
  @HttpCode(HttpStatus.CREATED)
  async registrarAjuste(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AjusteCajaDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<OneQuery<unknown>> {
    const ajuste = await this.transactionsService.registrarAjuste(id, dto, usuario);
    return new OneQuery(ajuste, 'CREATED', [new MensajeQuery('AJUSTE_201', 'Ajuste registrado de forma auditable.')]);
  }

  // =========================================================================
  // MOVIMIENTOS EXTRAORDINARIOS DE CAJA
  // =========================================================================

  @Post('movimientos')
  @RequirePermission(MODULO.TRANSACTIONS, ACCION.CREAR)
  @HttpCode(HttpStatus.CREATED)
  async registrarMovimiento(
    @Body() dto: MovimientoCajaDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<OneQuery<unknown>> {
    const movimiento = await this.transactionsService.registrarMovimiento(dto, usuario);
    return new OneQuery(movimiento, 'CREATED', [
      new MensajeQuery('MOV_201', 'Movimiento de caja registrado.'),
    ]);
  }

  // =========================================================================
  // COBRO DE COMANDA (POS CAJA)
  // =========================================================================

  @Post('cobrar')
  @RequirePermission(MODULO.TRANSACTIONS, ACCION.COBRAR)
  @HttpCode(HttpStatus.CREATED)
  async cobrarPedido(
    @Body() dto: CobroPedidoDto,
    @CurrentUser() usuario: UsuarioAutenticado,
    @Headers('idempotency-key') clave: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OneQuery<unknown>> {
    const cobro = await this.transactionsService.cobrarPedido(dto, usuario, validarClaveIdempotencia(clave, true) as string);
    if (cobro.reutilizado) {
      res.status(HttpStatus.OK);
      return new OneQuery(cobro, 'OK', [new MensajeQuery('PAGO_200', 'Ese cobro ya estaba registrado; no se repitió.')]);
    }
    const mensaje =
      cobro.estado_pago === 'pagado'
        ? 'Pedido pagado por completo.'
        : `Pago registrado. Saldo pendiente: S/ ${cobro.saldo_pendiente}.`;
    return new OneQuery(cobro, 'CREATED', [new MensajeQuery('PAGO_201', mensaje)]);
  }

  /** Devolución total o parcial de un cobro (TRANSACTIONS:DEVOLVER). Idempotency-Key obligatoria. */
  @Post('devoluciones')
  @RequirePermission(MODULO.TRANSACTIONS, ACCION.DEVOLVER)
  @HttpCode(HttpStatus.CREATED)
  async registrarDevolucion(
    @Body() dto: DevolucionDto,
    @CurrentUser() usuario: UsuarioAutenticado,
    @Headers('idempotency-key') clave: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OneQuery<unknown>> {
    const resultado = await this.transactionsService.registrarDevolucion(dto, usuario, validarClaveIdempotencia(clave, true) as string);
    if (resultado.reutilizado) {
      res.status(HttpStatus.OK);
      return new OneQuery(resultado, 'OK', [new MensajeQuery('DEV_200', 'Esa devolución ya estaba registrada; no se repitió.')]);
    }
    return new OneQuery(resultado, 'CREATED', [new MensajeQuery('DEV_201', 'Devolución registrada y auditada.')]);
  }

  @Get('historial')
  @RequirePermission(MODULO.TRANSACTIONS, ACCION.LEER)
  async listarHistorial(
    @CurrentUser() usuario: UsuarioAutenticado,
    @Query('id_turno', new ParseUUIDPipe({ version: '4', optional: true })) idTurno?: string,
  ): Promise<CheckStatus<unknown>> {
    const historial = await this.transactionsService.listarHistorial(usuario, idTurno);
    return new CheckStatus(
      'OK',
      [new MensajeQuery('HIST_200', 'Historial de transacciones recuperado.')],
      '',
      historial,
    );
  }
}