import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { KdsService } from './kds.service';
import { UpdateItemSocketDto } from './dto/update-item-socket.dto';
import { MesaLimpiezaDto } from './dto/mesa-limpieza.dto';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'kds',
})
export class KdsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(KdsGateway.name);

  constructor(private readonly kdsService: KdsService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Terminal KDS conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Terminal KDS desconectado: ${client.id}`);
  }

  // =========================================================================
  // MÉTODOS PÚBLICOS DE DIFUSIÓN (Llamados por OrdersService y TablesService)
  // =========================================================================

  /**
   * Emite la nueva tarjeta de comanda en vivo a todas las pantallas de cocina/barra
   */
  emitirNuevaComanda(payload: unknown) {
    this.server.emit('kds:nueva-comanda', payload);
  }

  /**
   * Emite cambio de estado de comanda (ej: 'en_preparacion' o 'listo')
   */
  emitirEstadoComandaActualizado(idPedido: string, nuevoEstado: string) {
    this.server.emit('kds:comanda-estado', { id_pedido: idPedido, estado: nuevoEstado });
  }

  /**
   * Emite cambio de estado de mesa (ej: 'Esperando limpieza' -> 'Marcar Lista')
   */
  emitirCambioEstadoMesa(idMesa: string, estado: string) {
    this.server.emit('mesa:estado-actualizado', { id_mesa: idMesa, estado });
  }

  // =========================================================================
  // LISTENERS DE MENSAJES RECIBIDOS DESDE LA UI DE COCINA/BARRA
  // =========================================================================

  /**
   * Botón 'Preparado' o 'Volver a hacer' de la Imagen 2
   */
  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage('kds:cambiar-estado-item')
  async handleCambiarEstadoItem(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: UpdateItemSocketDto,
  ) {
    const itemActualizado = await this.kdsService.actualizarEstadoItem(
      dto.id_pedido_detalle,
      dto.estado_kds,
      dto.despachado_por,
    );

    // Reenvía a todas las demás pantallas para que se sincronice el check verde al instante
    this.server.emit('kds:item-actualizado', {
      id_pedido: dto.id_pedido,
      id_pedido_detalle: dto.id_pedido_detalle,
      estado_kds: dto.estado_kds,
      completado: dto.estado_kds === 'despachado',
    });

    return { status: 'OK', data: itemActualizado };
  }

  /**
   * Botón 'Marcar Lista' en mesas 'Esperando limpieza' (Imagen 1)
   */
  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage('kds:cambiar-estado-limpieza')
  async handleCambiarEstadoLimpieza(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: MesaLimpiezaDto,
  ) {
    this.emitirCambioEstadoMesa(dto.id_mesa, dto.nuevo_estado);
    return { status: 'OK' };
  }
}