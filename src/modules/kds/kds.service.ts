import { Injectable, Inject, ConflictException, NotFoundException } from '@nestjs/common';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { pedidos, pedidos_detalle } from '../../common/database/schema/orders.schema';
import { mesas } from '../../common/database/schema/tables.schema';
import { DateUtils } from '../../core/utils/date.utils';
import { AuditLoggerService } from '../../common/audit/audit-logger.service';
import { RealtimeBus } from '../../common/realtime/realtime-bus.service';

export type EstadoItemKds = 'cola' | 'preparando' | 'despachado';

/** Estados del pedido que siguen en la cola de cocina/barra (KDS-001). 'listo' sale del tablero (KDS-007: no se borra). */
export const ESTADOS_EN_COLA = ['pendiente', 'en_preparacion'] as const;

interface ModificadorSnapshotKds {
  grupo?: string;
  opcion?: string;
}

interface DetalleParaKds {
  id_pedido_detalle: string;
  nombre_producto: string;
  cantidad: number;
  notas_preparacion: string | null;
  modificadores: unknown;
  estado_kds: string | null;
}

interface PedidoParaKds {
  id_pedido: string;
  id_mesa: string | null;
  mesa_numero: string | null;
  tipo_pedido: string | null;
  estado: string | null;
  fecha_creacion: Date | null;
}

export interface ItemKds {
  id_pedido_detalle: string;
  nombre_producto: string;
  cantidad: number;
  notas_preparacion: string | null;
  modificadores: { grupo: string; opcion: string }[];
  estado_kds: string;
  completado: boolean;
}

export interface TarjetaKds {
  id_pedido: string;
  id_mesa: string | null;
  mesa_numero: string | null;
  tipo_pedido: string;
  estado: string;
  fecha_creacion: Date | null;
  minutos_transcurridos: number;
  items: ItemKds[];
}

/**
 * Cocina/barra (KDS-001..009). Es la ÚNICA vía para cambiar el estado de un ítem: el endpoint HTTP y el evento
 * WebSocket pasan por `cambiarEstadoItem`. KDS nunca expone ni modifica precios ni importes (KDS-009).
 */
@Injectable()
export class KdsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly audit: AuditLoggerService,
    private readonly bus: RealtimeBus,
  ) {}

  // =========================================================================
  // TABLERO
  // =========================================================================

  /** Convierte un ítem de BD a la vista de cocina: sin precios, con modificadores y notas (KDS-004, KDS-009). */
  static vistaItem(d: DetalleParaKds): ItemKds {
    const mods = Array.isArray(d.modificadores) ? (d.modificadores as ModificadorSnapshotKds[]) : [];
    return {
      id_pedido_detalle: d.id_pedido_detalle,
      nombre_producto: d.nombre_producto,
      cantidad: d.cantidad,
      notas_preparacion: d.notas_preparacion,
      modificadores: mods.map((m) => ({ grupo: m.grupo ?? '', opcion: m.opcion ?? '' })),
      estado_kds: d.estado_kds ?? 'cola',
      completado: d.estado_kds === 'despachado',
    };
  }

  static armarTarjeta(pedido: PedidoParaKds, items: DetalleParaKds[]): TarjetaKds {
    const creada = pedido.fecha_creacion ? new Date(pedido.fecha_creacion).getTime() : Date.now();
    return {
      id_pedido: pedido.id_pedido,
      id_mesa: pedido.id_mesa,
      mesa_numero: pedido.mesa_numero,
      tipo_pedido: pedido.tipo_pedido ?? 'salon',
      estado: pedido.estado ?? 'pendiente',
      fecha_creacion: pedido.fecha_creacion,
      minutos_transcurridos: Math.max(0, Math.floor((Date.now() - creada) / 60000)),
      items: items.map((d) => KdsService.vistaItem(d)),
    };
  }

  /** Cola activa ordenada por antigüedad (KDS-001/002/003). */
  async obtenerTablero(): Promise<TarjetaKds[]> {
    const activos = await this.db
      .select({
        id_pedido: pedidos.id_pedido,
        id_mesa: pedidos.id_mesa,
        mesa_numero: sql<string | null>`coalesce(${pedidos.mesa_numero}, ${mesas.numero})`,
        tipo_pedido: pedidos.tipo_pedido,
        estado: pedidos.estado,
        fecha_creacion: pedidos.fecha_creacion,
      })
      .from(pedidos)
      .leftJoin(mesas, eq(pedidos.id_mesa, mesas.id_mesa))
      .where(and(eq(pedidos.eliminado, false), inArray(pedidos.estado, [...ESTADOS_EN_COLA])))
      .orderBy(pedidos.fecha_creacion);
    if (activos.length === 0) return [];

    const items = await this.db
      .select()
      .from(pedidos_detalle)
      .where(
        and(
          inArray(
            pedidos_detalle.id_pedido,
            activos.map((p) => p.id_pedido),
          ),
          eq(pedidos_detalle.eliminado, false),
        ),
      )
      .orderBy(pedidos_detalle.fecha_creacion);

    return activos.map((p) => KdsService.armarTarjeta(p, items.filter((i) => i.id_pedido === p.id_pedido)));
  }

  /** Tarjeta de un pedido (para publicarla cuando reaparece en la cola tras revertir su estado). */
  async obtenerTarjeta(idPedido: string): Promise<TarjetaKds | null> {
    const [pedido] = await this.db
      .select({
        id_pedido: pedidos.id_pedido,
        id_mesa: pedidos.id_mesa,
        mesa_numero: sql<string | null>`coalesce(${pedidos.mesa_numero}, ${mesas.numero})`,
        tipo_pedido: pedidos.tipo_pedido,
        estado: pedidos.estado,
        fecha_creacion: pedidos.fecha_creacion,
      })
      .from(pedidos)
      .leftJoin(mesas, eq(pedidos.id_mesa, mesas.id_mesa))
      .where(and(eq(pedidos.id_pedido, idPedido), eq(pedidos.eliminado, false)));
    if (!pedido) return null;

    const items = await this.db
      .select()
      .from(pedidos_detalle)
      .where(and(eq(pedidos_detalle.id_pedido, idPedido), eq(pedidos_detalle.eliminado, false)))
      .orderBy(pedidos_detalle.fecha_creacion);
    return KdsService.armarTarjeta(pedido, items);
  }

  // =========================================================================
  // ÍTEMS (único camino: HTTP y WebSocket)
  // =========================================================================

  /**
   * Cambia el estado de preparación de un ítem. Dentro de una transacción con bloqueo del pedido:
   *  - solo si el pedido sigue en la cola (pendiente/en_preparación); uno 'listo' se reabre desde Pedidos;
   *  - se audita toda reversión (despachado → otro estado, preparando → cola) (KDS-008);
   *  - el estado del pedido avanza solo: primer ítem en curso → en_preparación; todos despachados → listo.
   */
  async cambiarEstadoItem(idDetalle: string, estado: EstadoItemKds, idOperador: string) {
    const resultado = await this.db.transaction(async (tx) => {
      const [previo] = await tx
        .select({ id_pedido: pedidos_detalle.id_pedido })
        .from(pedidos_detalle)
        .where(and(eq(pedidos_detalle.id_pedido_detalle, idDetalle), eq(pedidos_detalle.eliminado, false)));
      if (!previo) throw new NotFoundException('El producto del pedido no existe.');

      // Primero el pedido (mismo orden de bloqueo que Pedidos y Caja), después el ítem.
      const [pedido] = await tx
        .select()
        .from(pedidos)
        .where(and(eq(pedidos.id_pedido, previo.id_pedido), eq(pedidos.eliminado, false)))
        .for('update');
      if (!pedido) throw new NotFoundException('El pedido del producto no existe.');

      const [detalle] = await tx
        .select()
        .from(pedidos_detalle)
        .where(and(eq(pedidos_detalle.id_pedido_detalle, idDetalle), eq(pedidos_detalle.eliminado, false)))
        .for('update');
      if (!detalle) throw new NotFoundException('El producto del pedido no existe.');

      const estadoPedido = pedido.estado ?? 'pendiente';
      const anterior = detalle.estado_kds ?? 'cola';
      // Dos pantallas que piden lo mismo a la vez: la segunda no es un error, el producto ya está así.
      if (anterior === estado) {
        return { detalle, idPedido: pedido.id_pedido, estadoPedido, cambioPedido: false, cambio: false };
      }
      if (!(ESTADOS_EN_COLA as readonly string[]).includes(estadoPedido)) {
        throw new ConflictException(
          estadoPedido === 'listo'
            ? 'El pedido ya está listo: reabre su estado desde Pedidos para volver a trabajar un producto.'
            : `No se puede modificar un producto de un pedido "${estadoPedido}".`,
        );
      }

      const ahora = DateUtils.ahoraUtc();
      const despacha = estado === 'despachado';
      const [actualizado] = await tx
        .update(pedidos_detalle)
        .set({
          estado_kds: estado,
          despachado_por: despacha ? idOperador : null,
          despachado_el: despacha ? ahora : null,
          fecha_edicion: ahora,
          usuario_edicion: idOperador,
        })
        .where(eq(pedidos_detalle.id_pedido_detalle, idDetalle))
        .returning();

      const esReversion = anterior === 'despachado' || (anterior === 'preparando' && estado === 'cola');
      if (esReversion) {
        await this.audit.registrarEnTransaccion(tx, {
          id_usuario: idOperador,
          evento: 'KDS_REVERSION_ITEM',
          nivel_severidad: 'WARN',
          detalles: {
            id_pedido: pedido.id_pedido,
            id_pedido_detalle: idDetalle,
            producto: detalle.nombre_producto,
            estado_anterior: anterior,
            estado_nuevo: estado,
          },
        });
      }

      // Estado del pedido derivado de sus ítems: solo avanza (bajarlo es una reversión explícita desde Pedidos).
      const items = await tx
        .select({ estado: pedidos_detalle.estado_kds })
        .from(pedidos_detalle)
        .where(and(eq(pedidos_detalle.id_pedido, pedido.id_pedido), eq(pedidos_detalle.eliminado, false)));
      const todosDespachados = items.length > 0 && items.every((i) => i.estado === 'despachado');
      const hayActividad = items.some((i) => i.estado !== 'cola');

      let nuevoEstadoPedido = estadoPedido;
      if (todosDespachados) nuevoEstadoPedido = 'listo';
      else if (hayActividad && estadoPedido === 'pendiente') nuevoEstadoPedido = 'en_preparacion';

      const cambioPedido = nuevoEstadoPedido !== estadoPedido;
      if (cambioPedido) {
        await tx
          .update(pedidos)
          .set({ estado: nuevoEstadoPedido, fecha_edicion: ahora, usuario_edicion: idOperador })
          .where(eq(pedidos.id_pedido, pedido.id_pedido));
      }

      return { detalle: actualizado, idPedido: pedido.id_pedido, estadoPedido: nuevoEstadoPedido, cambioPedido, cambio: true };
    });

    // Tras confirmar: todas las pantallas se sincronizan (KDS-006, ORD-012).
    if (resultado.cambio) {
      this.bus.emitir('kds:item-actualizado', {
        id_pedido: resultado.idPedido,
        id_pedido_detalle: idDetalle,
        estado_kds: estado,
        completado: estado === 'despachado',
        estado_pedido: resultado.estadoPedido,
      });
    }
    if (resultado.cambioPedido) {
      this.bus.emitir('kds:comanda-estado', { id_pedido: resultado.idPedido, estado: resultado.estadoPedido });
    }
    return { detalle: resultado.detalle, estado_pedido: resultado.estadoPedido };
  }

  // =========================================================================
  // MESAS
  // =========================================================================

  /**
   * Botón 'Marcar Lista': la mesa que esperaba limpieza (tras el cobro) vuelve a estar libre. Se persiste y se
   * difunde a las demás pantallas. Solo se permite desde 'por_limpiar'.
   */
  async marcarMesaLista(idMesa: string, idOperador: string) {
    const actualizada = await this.db.transaction(async (tx) => {
      const [mesa] = await tx
        .select()
        .from(mesas)
        .where(and(eq(mesas.id_mesa, idMesa), eq(mesas.eliminado, false)))
        .for('update');
      if (!mesa) throw new NotFoundException('La mesa no existe o fue retirada.');
      if (mesa.estado !== 'por_limpiar') {
        throw new ConflictException('Solo una mesa pendiente de limpieza puede marcarse como lista.');
      }

      const [fila] = await tx
        .update(mesas)
        .set({ estado: 'libre', fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: idOperador })
        .where(eq(mesas.id_mesa, idMesa))
        .returning();
      return fila;
    });
    this.bus.emitir('mesa:estado-actualizado', { id_mesa: actualizada.id_mesa, estado: actualizada.estado });
    return actualizada;
  }
}
