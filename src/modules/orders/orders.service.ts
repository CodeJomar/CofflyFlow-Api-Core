import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  forwardRef,
} from '@nestjs/common';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { pedidos, pedidos_detalle } from '../../common/database/schema/orders.schema';
import { productos } from '../../common/database/schema/menu.schema';
import { mesas } from '../../common/database/schema/tables.schema';
import { turnos_caja } from '../../common/database/schema/transactions.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateItemKdsDto } from './dto/update-item-kds.dto';
import { KdsGateway } from '../kds/kds.gateway';
import { DateUtils } from '../../core/utils/date.utils';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(forwardRef(() => KdsGateway))
    private readonly kdsGateway: KdsGateway,
  ) {}

  // =========================================================================
  // CREACIÓN DE COMANDA (POS / MESERO)
  // =========================================================================

  async crearPedido(dto: CreateOrderDto, idOperador: string) {
    // 1. Validar que el turno de caja esté abierto
    const [turno] = await this.db
      .select({ id: turnos_caja.id_turno_caja, estado: turnos_caja.estado })
      .from(turnos_caja)
      .where(and(eq(turnos_caja.id_turno_caja, dto.id_turno_caja), eq(turnos_caja.eliminado, false)))
      .limit(1);

    if (!turno || turno.estado !== 'abierta') {
      throw new BadRequestException('No se puede crear el pedido: el turno de caja no existe o está cerrado.');
    }

    // 2. Si es pedido de salón, validar y reservar mesa
    let numeroMesa: string | null = null;
    if (dto.tipo_pedido === 'salon') {
      if (!dto.id_mesa) {
        throw new BadRequestException('Los pedidos de salón requieren especificar una mesa (id_mesa).');
      }

      const [mesa] = await this.db
        .select()
        .from(mesas)
        .where(and(eq(mesas.id_mesa, dto.id_mesa), eq(mesas.eliminado, false)))
        .limit(1);

      if (!mesa) {
        throw new NotFoundException('La mesa indicada no existe.');
      }
      numeroMesa = mesa.numero;
    }

    // 3. Validar productos y calcular subtotal con snapshots inmutables
    const idsProductos = dto.items.map((i) => i.id_producto);
    const productosDb = await this.db
      .select()
      .from(productos)
      .where(and(inArray(productos.id_producto, idsProductos), eq(productos.eliminado, false)));

    if (productosDb.length !== idsProductos.length) {
      throw new BadRequestException('Uno o más productos del pedido no existen o están dados de baja.');
    }

    // Verificar si algún producto está marcado como NO DISPONIBLE
    const noDisponibles = productosDb.filter((p) => !p.disponible);
    if (noDisponibles.length > 0) {
      const nombres = noDisponibles.map((p) => p.nombre).join(', ');
      throw new BadRequestException(`Los siguientes productos están actualmente agotados: ${nombres}`);
    }

    // Cálculo monetario preciso
    let subtotalAcumulado = 0;
    const detallesParaInsertar = dto.items.map((item) => {
      const prod = productosDb.find((p) => p.id_producto === item.id_producto)!;
      const precioNum = Number(prod.precio);
      const subtotalLinea = precioNum * item.cantidad;
      subtotalAcumulado += subtotalLinea;

      return {
        id_producto: prod.id_producto,
        nombre_producto: prod.nombre,
        cantidad: item.cantidad,
        precio_unitario: prod.precio,
        subtotal: subtotalLinea.toFixed(2),
        notas_preparacion: item.notas_preparacion ?? null,
        modificadores: item.modificadores ? JSON.stringify(item.modificadores) : null,
        estado_kds: 'cola',
        usuario_creacion: idOperador,
        usuario_edicion: idOperador,
      };
    });

    const descuentoNum = Number(dto.descuento || 0);
    const totalCalculado = Math.max(0, subtotalAcumulado - descuentoNum).toFixed(2);

    // 4. Inserción atómica en base de datos
    const [nuevoPedido] = await this.db
      .insert(pedidos)
      .values({
        id_mesa: dto.id_mesa ?? null,
        id_turno_caja: dto.id_turno_caja,
        tipo_pedido: dto.tipo_pedido ?? 'salon',
        estado: 'pendiente',
        subtotal: subtotalAcumulado.toFixed(2),
        descuento: descuentoNum.toFixed(2),
        total_calculado: totalCalculado,
        usuario_creacion: idOperador,
        usuario_edicion: idOperador,
      })
      .returning();

    // Insertar líneas de detalle vinculadas
    const detallesCreados = await this.db
      .insert(pedidos_detalle)
      .values(
        detallesParaInsertar.map((d) => ({
          ...d,
          id_pedido: nuevoPedido.id_pedido,
        })),
      )
      .returning();

    // Si fue de salón, marcar la mesa como ocupada
    if (dto.id_mesa) {
      await this.db
        .update(mesas)
        .set({
          estado: 'ocupada',
          fecha_edicion: DateUtils.ahoraUtc(),
          usuario_edicion: idOperador,
        })
        .where(eq(mesas.id_mesa, dto.id_mesa));
    }

    // 5. Emitir evento por WebSockets para pantalla KDS en tiempo real
    if (this.kdsGateway) {
      this.kdsGateway.emitirNuevaComanda({
        id_pedido: nuevoPedido.id_pedido,
        id_mesa: nuevoPedido.id_mesa,
        numero_mesa: numeroMesa,
        tipo_pedido: nuevoPedido.tipo_pedido ?? 'salon',
        estado: nuevoPedido.estado ?? 'pendiente',
        total: nuevoPedido.total_calculado ?? '0.00',
        items: detallesCreados.map((d) => ({
          id_detalle: d.id_pedido_detalle,
          id_producto: d.id_producto,
          nombre_producto: d.nombre_producto,
          cantidad: d.cantidad,
          notas_preparacion: d.notas_preparacion,
          modificadores: d.modificadores,
        })),
        fecha_creacion: nuevoPedido.fecha_creacion,
      });
    }

    return {
      ...nuevoPedido,
      mesa_numero: numeroMesa,
      detalles: detallesCreados,
    };
  }

  // =========================================================================
  // CONSULTAS KDS Y SALÓN
  // =========================================================================

  async obtenerPedidoPorId(idPedido: string) {
    const [pedido] = await this.db
      .select({
        id_pedido: pedidos.id_pedido,
        id_mesa: pedidos.id_mesa,
        mesa_numero: mesas.numero,
        id_turno_caja: pedidos.id_turno_caja,
        tipo_pedido: pedidos.tipo_pedido,
        estado: pedidos.estado,
        subtotal: pedidos.subtotal,
        descuento: pedidos.descuento,
        total_calculado: pedidos.total_calculado,
        fecha_creacion: pedidos.fecha_creacion,
        fecha_edicion: pedidos.fecha_edicion,
      })
      .from(pedidos)
      .leftJoin(mesas, eq(pedidos.id_mesa, mesas.id_mesa))
      .where(and(eq(pedidos.id_pedido, idPedido), eq(pedidos.eliminado, false)))
      .limit(1);

    if (!pedido) {
      throw new NotFoundException('El pedido solicitado no existe.');
    }

    const detalles = await this.db
      .select()
      .from(pedidos_detalle)
      .where(and(eq(pedidos_detalle.id_pedido, idPedido), eq(pedidos_detalle.eliminado, false)))
      .orderBy(pedidos_detalle.fecha_creacion);

    return {
      ...pedido,
      detalles,
    };
  }

  async listarPedidosKds() {
    const pedidosActivos = await this.db
      .select({
        id_pedido: pedidos.id_pedido,
        id_mesa: pedidos.id_mesa,
        mesa_numero: mesas.numero,
        tipo_pedido: pedidos.tipo_pedido,
        estado: pedidos.estado,
        total_calculado: pedidos.total_calculado,
        fecha_creacion: pedidos.fecha_creacion,
      })
      .from(pedidos)
      .leftJoin(mesas, eq(pedidos.id_mesa, mesas.id_mesa))
      .where(
        and(
          eq(pedidos.eliminado, false),
          sql`${pedidos.estado} IN ('pendiente', 'en_preparacion', 'listo')`,
        ),
      )
      .orderBy(pedidos.fecha_creacion);

    if (pedidosActivos.length === 0) return [];

    const ids = pedidosActivos.map((p) => p.id_pedido);
    const todosDetalles = await this.db
      .select()
      .from(pedidos_detalle)
      .where(and(inArray(pedidos_detalle.id_pedido, ids), eq(pedidos_detalle.eliminado, false)));

    return pedidosActivos.map((p) => ({
      ...p,
      minutos_transcurridos: Math.floor(
        (Date.now() - new Date(p.fecha_creacion!).getTime()) / 60000,
      ),
      items: todosDetalles.filter((d) => d.id_pedido === p.id_pedido),
    }));
  }

  // =========================================================================
  // ACCIONES OPERATIVAS KDS
  // =========================================================================

  async actualizarEstadoPedido(idPedido: string, dto: UpdateOrderStatusDto, idOperador: string) {
    const pedido = await this.obtenerPedidoPorId(idPedido);

    const [actualizado] = await this.db
      .update(pedidos)
      .set({
        estado: dto.estado,
        fecha_edicion: DateUtils.ahoraUtc(),
        usuario_edicion: idOperador,
      })
      .where(eq(pedidos.id_pedido, idPedido))
      .returning();

    if (dto.estado === 'anulado' && pedido.id_mesa) {
      await this.db
        .update(mesas)
        .set({ estado: 'libre', fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: idOperador })
        .where(eq(mesas.id_mesa, pedido.id_mesa));
    }

    if (this.kdsGateway) {
      this.kdsGateway.emitirEstadoComandaActualizado(idPedido, dto.estado);
    }

    return actualizado;
  }

  async actualizarEstadoItemKds(idDetalle: string, dto: UpdateItemKdsDto, idOperador: string) {
    const [detalle] = await this.db
      .select()
      .from(pedidos_detalle)
      .where(and(eq(pedidos_detalle.id_pedido_detalle, idDetalle), eq(pedidos_detalle.eliminado, false)))
      .limit(1);

    if (!detalle) {
      throw new NotFoundException('El producto del pedido no existe.');
    }

    const camposActualizar: Record<string, unknown> = {
      estado_kds: dto.estado_kds,
      fecha_edicion: DateUtils.ahoraUtc(),
      usuario_edicion: idOperador,
    };

    if (dto.estado_kds === 'despachado') {
      camposActualizar.despachado_por = idOperador;
      camposActualizar.despachado_el = DateUtils.ahoraUtc();
    } else {
      camposActualizar.despachado_por = null;
      camposActualizar.despachado_el = null;
    }

    const [actualizado] = await this.db
      .update(pedidos_detalle)
      .set(camposActualizar)
      .where(eq(pedidos_detalle.id_pedido_detalle, idDetalle))
      .returning();

    return actualizado;
  }
}