import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateItemKdsDto } from './dto/update-item-kds.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OneQuery } from '../../core/dto/one-query.dto';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async crearPedido(
    @Body() dto: CreateOrderDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const pedido = await this.ordersService.crearPedido(dto, idOperador);
    return new OneQuery(pedido, 'CREATED', [
      new MensajeQuery('ORD_201', 'Comanda registrada y enviada a cocina/barra.'),
    ]);
  }

  /**
   * Vista de todas las comandas en curso para el tablero KDS (Imagen 1)
   */
  @Get('kds/tablero')
  async listarTableroKds(): Promise<CheckStatus<unknown>> {
    const pedidos = await this.ordersService.listarPedidosKds();
    return new CheckStatus(
      'OK',
      [new MensajeQuery('KDS_200', 'Tablero KDS recuperado.')],
      '',
      pedidos,
    );
  }

  /**
   * Detalle individual de un pedido para la pantalla de preparación ítem por ítem (Imagen 2)
   */
  @Get(':id')
  async obtenerPedidoPorId(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OneQuery<unknown>> {
    const pedido = await this.ordersService.obtenerPedidoPorId(id);
    return new OneQuery(pedido, 'OK', [
      new MensajeQuery('ORD_200', 'Detalle de comanda recuperado.'),
    ]);
  }

  /**
   * Botón 'Aceptar' o 'Completar' a nivel de comanda (Imagen 1 y 2)
   */
  @Patch(':id/estado')
  async actualizarEstadoPedido(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const pedido = await this.ordersService.actualizarEstadoPedido(id, dto, idOperador);
    return new OneQuery(pedido, 'OK', [
      new MensajeQuery('ORD_200', `Comanda actualizada a estado "${pedido.estado}".`),
    ]);
  }

  /**
   * Botones 'Preparado' y 'Volver a hacer' a nivel de ítem individual (Imagen 2)
   */
  @Patch('items/:idDetalle/estado-kds')
  async actualizarEstadoItemKds(
    @Param('idDetalle', new ParseUUIDPipe({ version: '4' })) idDetalle: string,
    @Body() dto: UpdateItemKdsDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const detalle = await this.ordersService.actualizarEstadoItemKds(idDetalle, dto, idOperador);
    return new OneQuery(detalle, 'OK', [
      new MensajeQuery('KDS_200', `Ítem marcado como "${detalle.estado_kds}".`),
    ]);
  }
}