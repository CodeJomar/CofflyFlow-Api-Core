import {
  Controller,
  Get,
  Post,
  Patch,
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
import { validarClaveIdempotencia } from '../../common/helpers/idempotency-key';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { UsuarioAutenticado } from '../auth/session.service';
import { OneQuery } from '../../core/dto/one-query.dto';
import { DataQuery } from '../../core/dto/data-query.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { MODULO, ACCION } from '../../common/security/permission-matrix';

/**
 * Pedidos. Las acciones de cocina/barra (tablero y cambio de estado de productos) viven en /kds.
 */
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @RequirePermission(MODULO.ORDERS, ACCION.CREAR)
  @HttpCode(HttpStatus.CREATED)
  async crearPedido(
    @Body() dto: CreateOrderDto,
    @CurrentUser() usuario: UsuarioAutenticado,
    @Headers('idempotency-key') clave: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OneQuery<unknown>> {
    const { pedido, reutilizado } = await this.ordersService.crearPedido(dto, usuario, validarClaveIdempotencia(clave, false));
    if (reutilizado) {
      // Reintento de una petición ya procesada: mismo pedido, sin duplicar ni reenviar nada a cocina.
      res.status(HttpStatus.OK);
      return new OneQuery(pedido, 'OK', [new MensajeQuery('ORD_200', 'Esa comanda ya estaba registrada; no se duplicó.')]);
    }
    return new OneQuery(pedido, 'CREATED', [
      new MensajeQuery('ORD_201', 'Comanda registrada y enviada a cocina/barra.'),
    ]);
  }

  /** Vista Pedidos: listado paginado con filtros (estado, tipo, mesa, fechas). Sin fechas: hoy. */
  @Get()
  @RequirePermission(MODULO.ORDERS, ACCION.LEER)
  async listarPedidos(@Query() query: ListOrdersQueryDto): Promise<DataQuery<unknown>> {
    const { filas, total, pagina, limite } = await this.ordersService.listarPedidos(query);
    return new DataQuery(filas, total, pagina, limite, 'OK', [new MensajeQuery('ORD_200', 'Pedidos recuperados.')]);
  }

  /** Comprobante interno del pedido: desglose con IGV, pagos por método, devoluciones y saldo. */
  @Get(':id/comprobante')
  @RequirePermission(MODULO.ORDERS, ACCION.LEER)
  async obtenerComprobante(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OneQuery<unknown>> {
    const comprobante = await this.ordersService.obtenerComprobante(id);
    return new OneQuery(comprobante, 'OK', [new MensajeQuery('ORD_200', 'Comprobante recuperado.')]);
  }

  @Get(':id')
  @RequirePermission(MODULO.ORDERS, ACCION.LEER)
  async obtenerPedidoPorId(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OneQuery<unknown>> {
    const pedido = await this.ordersService.obtenerPedidoPorId(id);
    return new OneQuery(pedido, 'OK', [
      new MensajeQuery('ORD_200', 'Detalle de comanda recuperado.'),
    ]);
  }

  /**
   * Cambia el estado del pedido: avanzar, completar, revertir o anular. Revertir y anular exigen `motivo`.
   */
  @Patch(':id/estado')
  @RequirePermission(MODULO.ORDERS, ACCION.EDITAR)
  async actualizarEstadoPedido(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<OneQuery<unknown>> {
    const pedido = await this.ordersService.actualizarEstadoPedido(id, dto, usuario);
    return new OneQuery(pedido, 'OK', [
      new MensajeQuery('ORD_200', `Comanda actualizada a estado "${pedido.estado}".`),
    ]);
  }
}
