import { Injectable, Inject } from '@nestjs/common';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { pedidos, pedidos_detalle } from '../../common/database/schema/orders.schema';
import { mesas } from '../../common/database/schema/tables.schema';
import { DateUtils } from '../../core/utils/date.utils';

@Injectable()
export class KdsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Obtiene la vista consolidada de mesas y comandas activas para la pantalla de inicio KDS (Imagen 1)
   */
  async obtenerTableroSalonyKds() {
    // 1. Obtener todas las mesas activas
    const listaMesas = await this.db
      .select()
      .from(mesas)
      .where(eq(mesas.eliminado, false))
      .orderBy(mesas.numero);

    // 2. Obtener pedidos que estén en preparación o pendientes
    const pedidosActivos = await this.db
      .select({
        id_pedido: pedidos.id_pedido,
        id_mesa: pedidos.id_mesa,
        tipo_pedido: pedidos.tipo_pedido,
        estado: pedidos.estado,
        fecha_creacion: pedidos.fecha_creacion,
      })
      .from(pedidos)
      .where(
        and(
          eq(pedidos.eliminado, false),
          sql`${pedidos.estado} IN ('pendiente', 'en_preparacion')`,
        ),
      );

    const idsPedidos = pedidosActivos.map((p) => p.id_pedido);
    let detalles: Array<typeof pedidos_detalle.$inferSelect> = [];

    if (idsPedidos.length > 0) {
      detalles = await this.db
        .select()
        .from(pedidos_detalle)
        .where(
          and(
            inArray(pedidos_detalle.id_pedido, idsPedidos),
            eq(pedidos_detalle.eliminado, false),
          ),
        );
    }

    // 3. Mapear cada mesa con su tarjeta KDS (como se ve en la Imagen 1)
    return listaMesas.map((mesa) => {
      const pedido = pedidosActivos.find((p) => p.id_mesa === mesa.id_mesa);

      if (!pedido) {
        return {
          id_mesa: mesa.id_mesa,
          numero: mesa.numero,
          capacidad: mesa.capacidad,
          estado_mesa: mesa.estado, // 'libre', 'por_limpiar', etc.
          pedido: null,
        };
      }

      const itemsPedido = detalles.filter((d) => d.id_pedido === pedido.id_pedido);
      const minutosTranscurridos = Math.floor(
        (Date.now() - new Date(pedido.fecha_creacion!).getTime()) / 60000,
      );

      return {
        id_mesa: mesa.id_mesa,
        numero: mesa.numero,
        capacidad: mesa.capacidad,
        estado_mesa: mesa.estado,
        pedido: {
          id_pedido: pedido.id_pedido,
          tipo_pedido: pedido.tipo_pedido,
          estado: pedido.estado,
          tiempo_transcurrido_minutos: minutosTranscurridos,
          total_items: itemsPedido.length,
          items: itemsPedido.map((i) => ({
            id_pedido_detalle: i.id_pedido_detalle,
            nombre_producto: i.nombre_producto,
            cantidad: i.cantidad,
            estado_kds: i.estado_kds, // 'cola', 'preparando', 'despachado'
            completado: i.estado_kds === 'despachado',
          })),
        },
      };
    });
  }

  /**
   * Actualiza el estado de preparación de un ítem directamente en BD
   */
  async actualizarEstadoItem(
    idDetalle: string,
    estadoKds: string,
    idOperador?: string,
  ) {
    const [actualizado] = await this.db
      .update(pedidos_detalle)
      .set({
        estado_kds: estadoKds,
        despachado_por: estadoKds === 'despachado' ? idOperador ?? null : null,
        despachado_el: estadoKds === 'despachado' ? DateUtils.ahoraUtc() : null,
        fecha_edicion: DateUtils.ahoraUtc(),
        usuario_edicion: idOperador ?? null,
      })
      .where(eq(pedidos_detalle.id_pedido_detalle, idDetalle))
      .returning();

    return actualizado;
  }
}