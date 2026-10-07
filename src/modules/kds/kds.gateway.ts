import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { HttpException, Logger, OnModuleDestroy, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { KdsService, type EstadoItemKds } from './kds.service';
import { RealtimeBus } from '../../common/realtime/realtime-bus.service';
import { UpdateItemSocketDto } from './dto/update-item-socket.dto';
import { MesaLimpiezaDto } from './dto/mesa-limpieza.dto';
import { WsAuthService } from '../auth/ws-auth.service';
import type { UsuarioAutenticado } from '../auth/session.service';
import { PermissionsService } from '../../common/security/permissions.service';
import { ACCION, MODULO } from '../../common/security/permission-matrix';
import { getCorsOrigins } from '../../common/config/cors-origins';
import { sanitizarRespuesta } from '../../common/security/sanitize-response';

type SocketAutenticado = Socket & { data: { usuario?: UsuarioAutenticado; eventos?: number[] } };

// Un cliente legítimo emite pocos eventos (tocar "preparado"); más de 30 en 10 s es abuso o un bucle con fallo.
const EVENTOS_MAX = 30;
const VENTANA_MS = 10_000;
const RESPUESTA_LIMITE = { status: 'ERROR', message: 'Demasiados eventos. Espera un momento.' };

const RESPUESTA_DENEGADA = { status: 'ERROR', message: 'No tienes permiso para realizar esta acción.' };

@WebSocketGateway({
  cors: {
    // Solo los orígenes web autorizados (se evalúa en cada conexión, cuando el .env ya está cargado).
    origin: (origen: string | undefined, callback: (error: Error | null, permitir?: boolean) => void) =>
      callback(null, !origen || getCorsOrigins().includes(origen)),
    credentials: true,
  },
  namespace: 'kds',
})
export class KdsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(KdsGateway.name);
  private suscripcion?: Subscription;

  constructor(
    private readonly kdsService: KdsService,
    private readonly wsAuth: WsAuthService,
    private readonly permisos: PermissionsService,
    private readonly bus: RealtimeBus,
  ) {}

  /**
   * Toda conexión debe autenticarse en el handshake (ticket de /auth/ws-ticket o cookie de sesión) y su
   * cargo debe poder consultar al menos KDS, pedidos o mesas. Sin eso el socket se rechaza antes de conectar.
   */
  afterInit(server: Server) {
    // Los servicios de negocio publican en el bus (después del commit); aquí se difunden a las pantallas conectadas.
    this.suscripcion = this.bus.eventos$.subscribe(({ evento, payload }) => server.emit(evento, payload));

    server.use(async (socket: SocketAutenticado, next) => {
      const usuario = await this.wsAuth.autenticar(socket);
      if (!usuario) return next(new Error('No autorizado'));

      const puedeConsultar =
        (await this.tiene(usuario, MODULO.KDS, ACCION.LEER)) ||
        (await this.tiene(usuario, MODULO.ORDERS, ACCION.LEER)) ||
        (await this.tiene(usuario, MODULO.TABLES, ACCION.LEER));
      if (!puedeConsultar) return next(new Error('No autorizado'));

      socket.data.usuario = usuario;
      next();
    });
  }

  handleConnection(client: SocketAutenticado) {
    this.logger.log(`Terminal conectada: ${client.id} (usuario ${client.data.usuario?.id_usuario})`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Terminal desconectada: ${client.id}`);
  }

  onModuleDestroy() {
    this.suscripcion?.unsubscribe();
  }

  // =========================================================================
  // LISTENERS DE MENSAJES RECIBIDOS DESDE LA UI DE COCINA/BARRA
  // =========================================================================

  /**
   * Botón 'Preparado' o 'Volver a hacer'. Requiere KDS:DESPACHAR; quién despacha lo determina la sesión
   * del socket, nunca un dato enviado por el cliente.
   */
  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage('kds:cambiar-estado-item')
  async handleCambiarEstadoItem(@ConnectedSocket() client: SocketAutenticado, @MessageBody() dto: UpdateItemSocketDto) {
    if (this.excedeLimite(client)) return RESPUESTA_LIMITE;
    const usuario = await this.sesionVigente(client, MODULO.KDS, ACCION.DESPACHAR);
    if (!usuario) return RESPUESTA_DENEGADA;

    try {
      // Mismo camino que el endpoint HTTP: valida, audita reversiones y difunde el cambio a todas las pantallas.
      const { detalle, estado_pedido } = await this.kdsService.cambiarEstadoItem(
        dto.id_pedido_detalle,
        dto.estado_kds as EstadoItemKds,
        usuario.id_usuario,
      );
      return { status: 'OK', data: sanitizarRespuesta({ ...detalle, estado_pedido }) };
    } catch (error) {
      return { status: 'ERROR', message: error instanceof HttpException ? error.message : 'No se pudo actualizar el producto.' };
    }

  }

  /**
   * Botón 'Marcar Lista' en mesas 'Esperando limpieza'. Requiere TABLES:CAMBIAR_ESTADO.
   */
  @UsePipes(new ValidationPipe({ transform: true }))
  @SubscribeMessage('kds:cambiar-estado-limpieza')
  async handleCambiarEstadoLimpieza(@ConnectedSocket() client: SocketAutenticado, @MessageBody() dto: MesaLimpiezaDto) {
    if (this.excedeLimite(client)) return RESPUESTA_LIMITE;
    const usuario = await this.sesionVigente(client, MODULO.TABLES, ACCION.CAMBIAR_ESTADO);
    if (!usuario) return RESPUESTA_DENEGADA;

    try {
      // Se persiste (por_limpiar -> libre) y el servicio difunde el cambio a las demás pantallas.
      await this.kdsService.marcarMesaLista(dto.id_mesa, usuario.id_usuario);
      return { status: 'OK' };
    } catch (error) {
      return { status: 'ERROR', message: error instanceof HttpException ? error.message : 'No se pudo actualizar la mesa.' };
    }
  }

  // =========================================================================
  // AUTORIZACIÓN
  // =========================================================================

  private async tiene(usuario: UsuarioAutenticado, modulo: string, accion: string): Promise<boolean> {
    if (usuario.tipo_cuenta === 'OWNER') return true;
    return usuario.id_rol ? this.permisos.tiene(usuario.id_rol, modulo, accion) : false;
  }

  /**
   * Antes de ejecutar un evento: la sesión sigue vigente (no hubo logout, baja ni suspensión) y el cargo
   * tiene el permiso. Si la sesión ya no es válida, el socket se desconecta.
   */
  private excedeLimite(client: SocketAutenticado): boolean {
    const ahora = Date.now();
    const recientes = ((client.data.eventos ?? []) as number[]).filter((t) => ahora - t < VENTANA_MS);
    recientes.push(ahora);
    client.data.eventos = recientes;
    return recientes.length > EVENTOS_MAX;
  }

  private async sesionVigente(client: SocketAutenticado, modulo: string, accion: string): Promise<UsuarioAutenticado | null> {
    const actual = client.data.usuario;
    const usuario = actual ? await this.wsAuth.revalidar(actual) : null;
    if (!usuario) {
      client.disconnect(true);
      return null;
    }
    client.data.usuario = usuario;
    return (await this.tiene(usuario, modulo, accion)) ? usuario : null;
  }
}
