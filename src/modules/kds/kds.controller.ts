import { Controller, Get, Patch, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { KdsService, type EstadoItemKds } from './kds.service';
import { UpdateItemKdsDto } from './dto/update-item-kds.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { MODULO, ACCION } from '../../common/security/permission-matrix';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { OneQuery } from '../../core/dto/one-query.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';

@Controller('kds')
export class KdsController {
  constructor(private readonly kds: KdsService) {}

  /** Cola activa de cocina/barra: pedidos pendientes o en preparación, con modificadores y notas, sin precios. */
  @Get('tablero')
  @RequirePermission(MODULO.KDS, ACCION.LEER)
  async tablero(): Promise<CheckStatus<unknown>> {
    const tarjetas = await this.kds.obtenerTablero();
    return new CheckStatus('OK', [new MensajeQuery('KDS_200', 'Tablero KDS recuperado.')], '', tarjetas);
  }

  /** Botones 'Preparado' y 'Volver a hacer' de un producto. Mismo flujo que el evento WebSocket. */
  @Patch('items/:idDetalle/estado')
  @RequirePermission(MODULO.KDS, ACCION.DESPACHAR)
  async cambiarEstadoItem(
    @Param('idDetalle', new ParseUUIDPipe({ version: '4' })) idDetalle: string,
    @Body() dto: UpdateItemKdsDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const { detalle, estado_pedido } = await this.kds.cambiarEstadoItem(idDetalle, dto.estado_kds as EstadoItemKds, idOperador);
    return new OneQuery({ ...detalle, estado_pedido }, 'OK', [
      new MensajeQuery('KDS_200', `Producto marcado como "${detalle.estado_kds}".`),
    ]);
  }
}
