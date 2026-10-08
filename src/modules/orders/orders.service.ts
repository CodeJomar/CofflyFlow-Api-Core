import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { eq, and, or, sql, inArray, ne, gte, lte, desc, count, ilike } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { pedidos, pedidos_detalle } from '../../common/database/schema/orders.schema';
import { productos } from '../../common/database/schema/menu.schema';
import { mesas } from '../../common/database/schema/tables.schema';
import { turnos_caja, transacciones_caja } from '../../common/database/schema/transactions.schema';
import { usuarios, auditoria_seguridad } from '../../common/database/schema/users.schema';
import { totalesPagos, estadoPago } from '../../common/helpers/pagos-pedido';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { KdsService } from '../kds/kds.service';
import { RealtimeBus } from '../../common/realtime/realtime-bus.service';
import { AuditLoggerService } from '../../common/audit/audit-logger.service';
import { DateUtils } from '../../core/utils/date.utils';
import { aCentimos, desdeCentimos } from '../../common/validators/money.validator';
import { PermissionsService } from '../../common/security/permissions.service';
import { ModifiersService } from '../menu/modifiers.service';
import { MODULO, ACCION } from '../../common/security/permission-matrix';
import type { UsuarioAutenticado } from '../auth/session.service';

// Transiciones válidas del estado de preparación. 'pagado' lo fija solo el cobro; 'pagado' y 'anulado' son finales.
const TRANSICIONES_PEDIDO: Record<string, string[]> = {
  pendiente: ['en_preparacion', 'anulado'],
  en_preparacion: ['pendiente', 'listo', 'anulado'],
  listo: ['en_preparacion', 'anulado'],
  pagado: [],
  anulado: [],
};

// Cambios que retroceden el flujo: exigen motivo y quedan auditados (ORD-008).
const REVERSIONES = new Set(['en_preparacion>pendiente', 'listo>en_preparacion']);

const MAX_DIAS_LISTADO = 92;

function esViolacionUnica(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly kds: KdsService,
    private readonly bus: RealtimeBus,
    private readonly audit: AuditLoggerService,
    private readonly permisos: PermissionsService,
    private readonly modifiers: ModifiersService,
  ) {}

  // =========================================================================
  // CREACIÓN DE COMANDA (POS / MESERO)
  // =========================================================================

  /**
   * Crea la comanda. Con `claveIdempotencia` (cabecera Idempotency-Key) la operación es idempotente: un doble clic, un
   * reintento de red o dos terminales con la misma clave producen UN solo pedido. La misma clave con un contenido
   * distinto se rechaza (409). La carrera entre dos peticiones simultáneas la resuelve el índice único de la base.
   */
  async crearPedido(dto: CreateOrderDto, usuario: UsuarioAutenticado, claveIdempotencia?: string) {
    if (!claveIdempotencia) return { pedido: await this.insertarPedido(dto, usuario), reutilizado: false };

    const huella = this.huellaDe(dto);
    const previo = await this.pedidoPorClave(usuario.id_usuario, claveIdempotencia, huella);
    if (previo) return { pedido: previo, reutilizado: true };

    try {
      return { pedido: await this.insertarPedido(dto, usuario, { clave: claveIdempotencia, huella }), reutilizado: false };
    } catch (error) {
      // Otra petición con la misma clave ganó la carrera: se devuelve su pedido en lugar de duplicar.
      if (!esViolacionUnica(error)) throw error;
      const ganador = await this.pedidoPorClave(usuario.id_usuario, claveIdempotencia, huella);
      if (ganador) return { pedido: ganador, reutilizado: true };
      throw error;
    }
  }

  private huellaDe(dto: CreateOrderDto): string {
    const normalizado = {
      tipo: dto.tipo_pedido ?? 'salon',
      mesa: dto.id_mesa ?? null,
      descuento: dto.descuento ?? '0.00',
      cliente: dto.cliente_nombre?.trim() || null,
      items: dto.items.map((i) => ({
        p: i.id_producto,
        c: i.cantidad,
        n: i.notas_preparacion ?? null,
        m: (i.modificadores ?? []).map((m) => m.id_opcion).sort(),
      })),
    };
    return createHash('sha256').update(JSON.stringify(normalizado)).digest('hex');
  }

  private async pedidoPorClave(idUsuario: string, clave: string, huella: string) {
    const [existente] = await this.db
      .select({ id: pedidos.id_pedido, huella: pedidos.huella_solicitud })
      .from(pedidos)
      .where(and(eq(pedidos.usuario_creacion, idUsuario), eq(pedidos.clave_idempotencia, clave)))
      .limit(1);
    if (!existente) return null;
    if (existente.huella !== huella) {
      throw new ConflictException('Esa Idempotency-Key ya se usó con un pedido distinto. Genera una clave nueva.');
    }
    return this.obtenerPedidoPorId(existente.id);
  }

  private async insertarPedido(
    dto: CreateOrderDto,
    usuario: UsuarioAutenticado,
    idempotencia?: { clave: string; huella: string },
  ) {
    const idOperador = usuario.id_usuario;

    // Aplicar un descuento es una acción con permiso propio: un mozo no puede regalar productos.
    const descuentoCentimos = aCentimos(dto.descuento ?? '0.00');
    if (descuentoCentimos > 0) {
      await this.permisos.exigir(usuario, MODULO.ORDERS, ACCION.DESCONTAR);
    }

    // Todo el alta (pedido, líneas y mesa) es atómica: o se guarda completa o no se guarda nada.
    const { nuevoPedido, detallesCreados, numeroMesa } = await this.db.transaction(async (tx) => {
      // 1. Turno de caja abierto del local (FOR SHARE: no puede cerrarse mientras se crea el pedido). Lo resuelve el
      //    servidor: quien toma el pedido no necesita conocerlo ni tener permisos de caja.
      const [turno] = await tx
        .select({ id: turnos_caja.id_turno_caja })
        .from(turnos_caja)
        .where(and(eq(turnos_caja.estado, 'abierta'), eq(turnos_caja.eliminado, false)))
        .for('share');

      if (!turno) {
        throw new ConflictException('La caja está cerrada: abre un turno de caja antes de tomar pedidos.');
      }
      if (dto.id_turno_caja && dto.id_turno_caja !== turno.id) {
        throw new BadRequestException('El turno indicado no es el turno de caja abierto.');
      }
      const idTurnoCaja = turno.id;

      // 2. Si es pedido de salón, validar la mesa.
      let numeroMesa: string | null = null;
      if (dto.tipo_pedido === 'salon') {
        if (!dto.id_mesa) {
          throw new BadRequestException('Los pedidos de salón requieren especificar una mesa (id_mesa).');
        }

        const [mesa] = await tx
          .select()
          .from(mesas)
          .where(and(eq(mesas.id_mesa, dto.id_mesa), eq(mesas.eliminado, false)))
          .limit(1)
          .for('update'); // serializa con el cobro / la limpieza de la misma mesa

        if (!mesa) {
          throw new NotFoundException('La mesa indicada no existe.');
        }
        if (mesa.estado === 'por_limpiar') {
          throw new ConflictException(`La mesa "${mesa.numero}" está pendiente de limpieza.`);
        }
        numeroMesa = mesa.numero;
      }

      // 3. Productos: precios y nombres SIEMPRE de la base (snapshot inmutable); el cliente solo elige producto y cantidad.
      const idsProductos = [...new Set(dto.items.map((i) => i.id_producto))];
      const productosDb = await tx
        .select()
        .from(productos)
        .where(and(inArray(productos.id_producto, idsProductos), eq(productos.eliminado, false)));

      if (productosDb.length !== idsProductos.length) {
        throw new BadRequestException('Uno o más productos del pedido no existen o están dados de baja.');
      }

      const noDisponibles = productosDb.filter((p) => !p.disponible);
      if (noDisponibles.length > 0) {
        const nombres = noDisponibles.map((p) => p.nombre).join(', ');
        throw new BadRequestException(`Los siguientes productos están actualmente agotados: ${nombres}`);
      }

      // Modificadores: el cliente solo envía ids de opciones; el servidor valida pertenencia, disponibilidad,
      // mínimos/máximos y obligatorios, y calcula la variación de precio y el snapshot a guardar.
      const lineasConProducto = dto.items.map((item) => ({
        item,
        prod: productosDb.find((p) => p.id_producto === item.id_producto)!,
      }));
      const selecciones = await this.modifiers.resolverSeleccion(
        tx,
        lineasConProducto.map(({ item, prod }) => ({
          id_producto: prod.id_producto,
          nombre_producto: prod.nombre,
          ids_opcion: (item.modificadores ?? []).map((m) => m.id_opcion),
        })),
      );

      // Cálculo monetario en céntimos enteros: (precio base + variación de modificadores) x cantidad.
      let subtotalCentimos = 0;
      const detallesParaInsertar = lineasConProducto.map(({ item, prod }, i) => {
        const { snapshot, deltaCentimos } = selecciones[i];
        const precioUnitarioCentimos = aCentimos(prod.precio) + deltaCentimos;
        if (precioUnitarioCentimos < 0) {
          throw new BadRequestException(`Los modificadores dejan "${prod.nombre}" con precio negativo.`);
        }
        const subtotalLinea = precioUnitarioCentimos * item.cantidad;
        subtotalCentimos += subtotalLinea;

        return {
          id_producto: prod.id_producto,
          nombre_producto: prod.nombre,
          cantidad: item.cantidad,
          precio_unitario: prod.precio, // snapshot del precio BASE; las variaciones van en 'modificadores'
          subtotal: desdeCentimos(subtotalLinea),
          notas_preparacion: item.notas_preparacion ?? null,
          modificadores: snapshot.length > 0 ? snapshot : null,
          estado_kds: 'cola',
          usuario_creacion: idOperador,
          usuario_edicion: idOperador,
        };
      });

      if (descuentoCentimos > subtotalCentimos) {
        throw new BadRequestException('El descuento no puede superar el subtotal del pedido.');
      }

      // 4. Inserción atómica.
      const [nuevoPedido] = await tx
        .insert(pedidos)
        .values({
          id_mesa: dto.id_mesa ?? null,
          mesa_numero: numeroMesa, // snapshot: el historial conserva el nombre que tenía la mesa (TAB-007)
          id_turno_caja: idTurnoCaja,
          tipo_pedido: dto.tipo_pedido ?? 'salon',
          cliente_nombre: dto.cliente_nombre?.trim() || null,
          estado: 'pendiente',
          clave_idempotencia: idempotencia?.clave ?? null,
          huella_solicitud: idempotencia?.huella ?? null,
          subtotal: desdeCentimos(subtotalCentimos),
          descuento: desdeCentimos(descuentoCentimos),
          total_calculado: desdeCentimos(subtotalCentimos - descuentoCentimos),
          usuario_creacion: idOperador,
          usuario_edicion: idOperador,
        })
        .returning();

      const detallesCreados = await tx
        .insert(pedidos_detalle)
        .values(detallesParaInsertar.map((d) => ({ ...d, id_pedido: nuevoPedido.id_pedido })))
        .returning();

      // Si fue de salón, marcar la mesa como ocupada.
      if (dto.id_mesa) {
        await tx
          .update(mesas)
          .set({ estado: 'ocupada', fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: idOperador })
          .where(eq(mesas.id_mesa, dto.id_mesa));
      }

      return { nuevoPedido, detallesCreados, numeroMesa };
    });

    // 5. Evento en tiempo real al KDS: solo DESPUÉS de confirmar la transacción, y sin precios (KDS-009).
    this.bus.emitir(
      'kds:nueva-comanda',
      KdsService.armarTarjeta({ ...nuevoPedido, mesa_numero: numeroMesa }, detallesCreados),
    );

    return {
      ...nuevoPedido,
      mesa_numero: numeroMesa,
      detalles: detallesCreados,
    };
  }

  // =========================================================================
  // CONSULTAS
  // =========================================================================

  async obtenerPedidoPorId(idPedido: string) {
    const [pedido] = await this.db
      .select({
        id_pedido: pedidos.id_pedido,
        id_mesa: pedidos.id_mesa,
        mesa_numero: sql<string | null>`coalesce(${pedidos.mesa_numero}, ${mesas.numero})`,
        id_turno_caja: pedidos.id_turno_caja,
        correlativo: pedidos.correlativo,
        cliente_nombre: pedidos.cliente_nombre,
        creado_por: usuarios.nombre,
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
      .leftJoin(usuarios, eq(pedidos.usuario_creacion, usuarios.id_usuario))
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

    const { pagadoCentimos, devueltoCentimos } = await totalesPagos(this.db, idPedido);
    const total = aCentimos(pedido.total_calculado ?? '0');
    return {
      ...pedido,
      estado_pago: estadoPago(total, pagadoCentimos, devueltoCentimos),
      total_pagado: desdeCentimos(pagadoCentimos),
      saldo_pendiente: desdeCentimos(Math.max(0, total - pagadoCentimos)),
      detalles,
    };
  }

  /**
   * Comprobante de venta INTERNO del pedido (desglose con IGV 18%, pagos por método, devoluciones y saldo). No es un
   * comprobante electrónico de SUNAT. Se ve desde el detalle del pedido. Los importes salen del libro de caja.
   */
  async obtenerComprobante(idPedido: string) {
    const pedido = await this.obtenerPedidoPorId(idPedido);

    const movimientos = await this.db
      .select({
        id_transaccion: transacciones_caja.id_transaccion_caja,
        id_transaccion_origen: transacciones_caja.id_transaccion_origen,
        tipo: transacciones_caja.tipo_movimiento,
        metodo_pago: transacciones_caja.metodo_pago,
        monto: transacciones_caja.monto,
        notas: transacciones_caja.notas,
        fecha: transacciones_caja.fecha_creacion,
        registrado_por: usuarios.nombre,
      })
      .from(transacciones_caja)
      .leftJoin(usuarios, eq(transacciones_caja.usuario_creacion, usuarios.id_usuario))
      .where(
        and(
          eq(transacciones_caja.id_pedido, idPedido),
          eq(transacciones_caja.eliminado, false),
          inArray(transacciones_caja.tipo_movimiento, ['venta', 'devolucion']),
        ),
      )
      .orderBy(transacciones_caja.fecha_creacion);

    const total = aCentimos(pedido.total_calculado ?? '0');
    const pagos = movimientos.filter((m) => m.tipo === 'venta');
    const devoluciones = movimientos.filter((m) => m.tipo === 'devolucion');
    const pagado = pagos.reduce((a, m) => a + aCentimos(m.monto), 0);
    const devuelto = devoluciones.reduce((a, m) => a + aCentimos(m.monto), 0);
    const base = Math.round(total / 1.18);

    const [{ copias }] = await this.db
      .select({ copias: count() })
      .from(auditoria_seguridad)
      .where(and(eq(auditoria_seguridad.evento, 'COMPROBANTE_REIMPRESO'), sql`${auditoria_seguridad.detalles}->>'id_pedido' = ${idPedido}`));

    return {
      numero: pedido.id_pedido.slice(0, 8).toUpperCase(),
      correlativo: pedido.correlativo,
      cliente_nombre: pedido.cliente_nombre,
      atendido_por: pedido.creado_por,
      reimpresiones: Number(copias),
      aviso: 'Comprobante interno de venta. No reemplaza a la boleta o factura electrónica.',
      fecha: pedido.fecha_creacion,
      mesa_numero: pedido.mesa_numero,
      tipo_pedido: pedido.tipo_pedido,
      estado: pedido.estado,
      estado_pago: estadoPago(total, pagado, devuelto),
      items: pedido.detalles.map((d) => ({
        producto: d.nombre_producto,
        cantidad: d.cantidad,
        precio_unitario: d.precio_unitario,
        modificadores: Array.isArray(d.modificadores) ? d.modificadores : [],
        notas_preparacion: d.notas_preparacion,
        subtotal: d.subtotal,
      })),
      subtotal: pedido.subtotal,
      descuento: pedido.descuento,
      total: desdeCentimos(total),
      desglose: { base_imponible: desdeCentimos(base), igv_18: desdeCentimos(total - base) },
      pagos: pagos.map((m) => ({ id_transaccion: m.id_transaccion, metodo_pago: m.metodo_pago, monto: m.monto, fecha: m.fecha, registrado_por: m.registrado_por })),
      devoluciones: devoluciones.map((m) => ({
        id_transaccion: m.id_transaccion,
        id_transaccion_origen: m.id_transaccion_origen,
        metodo_pago: m.metodo_pago,
        monto: m.monto,
        motivo: m.notas,
        fecha: m.fecha,
        registrado_por: m.registrado_por,
      })),
      total_pagado: desdeCentimos(pagado),
      total_devuelto: desdeCentimos(devuelto),
      neto_cobrado: desdeCentimos(pagado - devuelto),
      saldo_pendiente: desdeCentimos(Math.max(0, total - pagado)),
    };
  }

  /**
   * Listado de pedidos para la vista Pedidos (donde también se corrige el estado). Sin fechas: el día de hoy en
   * hora de Lima. Paginado; el más reciente primero.
   */
  async listarPedidos(query: ListOrdersQueryDto) {
    if (Boolean(query.fecha_inicio) !== Boolean(query.fecha_fin)) {
      throw new BadRequestException('Indica fecha_inicio y fecha_fin juntas (o ninguna, para ver el día de hoy).');
    }
    const hoy = DateUtils.formatearSoloFecha();
    const inicio = new Date(`${query.fecha_inicio ?? hoy}T00:00:00.000-05:00`);
    const fin = new Date(`${query.fecha_fin ?? hoy}T23:59:59.999-05:00`);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
      throw new BadRequestException('Las fechas del filtro no son válidas.');
    }
    if (inicio > fin) throw new BadRequestException('fecha_inicio no puede ser posterior a fecha_fin.');
    if ((fin.getTime() - inicio.getTime()) / 86_400_000 > MAX_DIAS_LISTADO) {
      throw new BadRequestException(`El rango no puede superar ${MAX_DIAS_LISTADO} días.`);
    }

    const condiciones = [
      eq(pedidos.eliminado, false),
      gte(pedidos.fecha_creacion, inicio),
      lte(pedidos.fecha_creacion, fin),
    ];
    if (query.estado) condiciones.push(eq(pedidos.estado, query.estado));
    if (query.tipo_pedido) condiciones.push(eq(pedidos.tipo_pedido, query.tipo_pedido));
    if (query.id_mesa) condiciones.push(eq(pedidos.id_mesa, query.id_mesa));
    const termino = query.busqueda?.trim();
    if (termino) {
      // Texto literal (los comodines del usuario se escapan): cliente, mesa, número de pedido o inicio del id.
      const literal = termino.replace(/[\\%_]/g, (c) => `\\${c}`);
      const buscar = [
        ilike(pedidos.cliente_nombre, `%${literal}%`),
        ilike(pedidos.mesa_numero, `%${literal}%`),
        sql`${pedidos.id_pedido}::text ilike ${literal + '%'}`,
      ];
      const numero = termino.replace(/^#/, '');
      if (/^\d{1,9}$/.test(numero)) buscar.push(eq(pedidos.correlativo, Number(numero)));
      condiciones.push(or(...buscar)!);
    }
    const donde = and(...condiciones);

    const pagina = query.pagina ?? 1;
    const limite = query.limite ?? 10;

    const [{ total }] = await this.db.select({ total: count() }).from(pedidos).where(donde);
    const filas = await this.db
      .select({
        id_pedido: pedidos.id_pedido,
        id_mesa: pedidos.id_mesa,
        mesa_numero: sql<string | null>`coalesce(${pedidos.mesa_numero}, ${mesas.numero})`,
        correlativo: pedidos.correlativo,
        cliente_nombre: pedidos.cliente_nombre,
        creado_por: usuarios.nombre,
        tipo_pedido: pedidos.tipo_pedido,
        estado: pedidos.estado,
        subtotal: pedidos.subtotal,
        descuento: pedidos.descuento,
        total_calculado: pedidos.total_calculado,
        fecha_creacion: pedidos.fecha_creacion,
        fecha_edicion: pedidos.fecha_edicion,
        total_items: sql<number>`(select coalesce(sum(d.cantidad), 0)::int from pedidos_detalle d where d.id_pedido = ${pedidos.id_pedido} and d.eliminado = false)`,
        total_pagado: sql<string>`(select coalesce(sum(t.monto), 0)::text from transacciones_caja t where t.id_pedido = ${pedidos.id_pedido} and t.tipo_movimiento = 'venta' and t.eliminado = false)`,
        total_devuelto: sql<string>`(select coalesce(sum(t.monto), 0)::text from transacciones_caja t where t.id_pedido = ${pedidos.id_pedido} and t.tipo_movimiento = 'devolucion' and t.eliminado = false)`,
      })
      .from(pedidos)
      .leftJoin(mesas, eq(pedidos.id_mesa, mesas.id_mesa))
      .leftJoin(usuarios, eq(pedidos.usuario_creacion, usuarios.id_usuario))
      .where(donde)
      .orderBy(desc(pedidos.fecha_creacion))
      .limit(limite)
      .offset((pagina - 1) * limite);

    const filasConPago = filas.map(({ total_devuelto, ...f }) => ({
      ...f,
      estado_pago: estadoPago(aCentimos(f.total_calculado ?? '0'), aCentimos(f.total_pagado), aCentimos(total_devuelto)),
      saldo_pendiente: desdeCentimos(Math.max(0, aCentimos(f.total_calculado ?? '0') - aCentimos(f.total_pagado))),
    }));
    return { filas: filasConPago, total: Number(total), pagina, limite };
  }

  /**
   * Bitácora del pedido, de la más antigua a la más reciente: creación, cobros, devoluciones y los eventos
   * auditados (anulación, reversiones de estado y reimpresiones del comprobante).
   */
  async obtenerHistorial(idPedido: string) {
    const pedido = await this.obtenerPedidoPorId(idPedido);

    const movimientos = await this.db
      .select({
        tipo: transacciones_caja.tipo_movimiento,
        metodo_pago: transacciones_caja.metodo_pago,
        monto: transacciones_caja.monto,
        notas: transacciones_caja.notas,
        fecha: transacciones_caja.fecha_creacion,
        usuario: usuarios.nombre,
      })
      .from(transacciones_caja)
      .leftJoin(usuarios, eq(transacciones_caja.usuario_creacion, usuarios.id_usuario))
      .where(
        and(
          eq(transacciones_caja.id_pedido, idPedido),
          eq(transacciones_caja.eliminado, false),
          inArray(transacciones_caja.tipo_movimiento, ['venta', 'devolucion']),
        ),
      );

    const auditados = await this.db
      .select({
        evento: auditoria_seguridad.evento,
        detalles: auditoria_seguridad.detalles,
        fecha: auditoria_seguridad.fecha_creacion,
        usuario: usuarios.nombre,
      })
      .from(auditoria_seguridad)
      .leftJoin(usuarios, eq(auditoria_seguridad.id_usuario, usuarios.id_usuario))
      .where(
        and(
          inArray(auditoria_seguridad.evento, ['PEDIDO_ANULADO', 'PEDIDO_ESTADO_REVERTIDO', 'COMPROBANTE_REIMPRESO']),
          sql`${auditoria_seguridad.detalles}->>'id_pedido' = ${idPedido}`,
        ),
      );

    const eventos: Array<{ accion: string; fecha: Date | string | null; usuario: string | null; detalle: string | null }> = [
      { accion: 'creado', fecha: pedido.fecha_creacion, usuario: pedido.creado_por, detalle: null },
      ...movimientos.map((m) => ({
        accion: m.tipo === 'venta' ? 'cobrado' : 'devuelto',
        fecha: m.fecha,
        usuario: m.usuario,
        detalle: m.tipo === 'venta' ? `${m.metodo_pago} S/ ${m.monto}` : `${m.metodo_pago} S/ ${m.monto} · ${m.notas ?? ''}`.trim(),
      })),
      ...auditados.map((a) => {
        const d = (a.detalles ?? {}) as { motivo?: string; estado_anterior?: string; estado_nuevo?: string };
        return {
          accion: a.evento === 'PEDIDO_ANULADO' ? 'anulado' : a.evento === 'COMPROBANTE_REIMPRESO' ? 'reimpreso' : 'revertido',
          fecha: a.fecha,
          usuario: a.usuario,
          detalle: d.motivo ?? (d.estado_anterior ? `${d.estado_anterior} → ${d.estado_nuevo}` : null),
        };
      }),
    ];
    eventos.sort((a, b) => new Date(a.fecha ?? 0).getTime() - new Date(b.fecha ?? 0).getTime());
    return eventos;
  }

  /** Reimprime el comprobante: queda registrado quién lo pidió y se devuelve con el número de copia. */
  async reimprimirComprobante(idPedido: string, usuario: UsuarioAutenticado) {
    const antes = await this.obtenerComprobante(idPedido);
    await this.audit.registrarEnTransaccion(this.db, {
      id_usuario: usuario.id_usuario,
      evento: 'COMPROBANTE_REIMPRESO',
      detalles: { id_pedido: idPedido, copia: antes.reimpresiones + 1 },
    });
    return { ...antes, reimpresiones: antes.reimpresiones + 1, es_copia: true };
  }

  // =========================================================================
  // CAMBIO DE ESTADO DEL PEDIDO
  // =========================================================================

  /**
   * Cambia el estado de PREPARACIÓN del pedido (el estado financiero 'pagado' solo lo fija el cobro en Caja).
   *  - ORD-009: solo transiciones válidas; 'pagado' y 'anulado' son finales.
   *  - ORD-008: anular y revertir (en_preparacion→pendiente, listo→en_preparacion) exigen motivo y quedan auditados
   *    DENTRO de la transacción con estado anterior y nuevo.
   *  - Anular exige ORDERS:ANULAR. Completar ('listo') despacha los productos que faltaban.
   *  - Un pedido que vuelve a la cola reaparece en el KDS; uno que sale (listo/anulado) desaparece.
   */
  async actualizarEstadoPedido(idPedido: string, dto: UpdateOrderStatusDto, usuario: UsuarioAutenticado) {
    const idOperador = usuario.id_usuario;
    if (dto.estado === 'anulado') await this.permisos.exigir(usuario, MODULO.ORDERS, ACCION.ANULAR);

    const resultado = await this.db.transaction(async (tx) => {
      const [pedido] = await tx
        .select()
        .from(pedidos)
        .where(and(eq(pedidos.id_pedido, idPedido), eq(pedidos.eliminado, false)))
        .for('update');

      if (!pedido) {
        throw new NotFoundException('El pedido solicitado no existe.');
      }

      const estadoActual = pedido.estado ?? 'pendiente';
      if (estadoActual === dto.estado) return { fila: pedido, cambio: false, mesaLiberada: false };

      if (!(TRANSICIONES_PEDIDO[estadoActual] ?? []).includes(dto.estado)) {
        throw new ConflictException(`No se puede pasar un pedido de "${estadoActual}" a "${dto.estado}".`);
      }

      const esReversion = REVERSIONES.has(`${estadoActual}>${dto.estado}`);
      const motivo = dto.motivo?.trim();
      if ((dto.estado === 'anulado' || esReversion) && !motivo) {
        throw new BadRequestException('Indica el motivo: es obligatorio al anular o revertir el estado de un pedido.');
      }

      if (dto.estado === 'anulado') {
        const { pagadoCentimos, devueltoCentimos } = await totalesPagos(tx, idPedido);
        if (pagadoCentimos - devueltoCentimos > 0) {
          throw new ConflictException('El pedido tiene cobros registrados: devuélvelos antes de anularlo.');
        }
      }

      const ahora = DateUtils.ahoraUtc();
      const [fila] = await tx
        .update(pedidos)
        .set({ estado: dto.estado, fecha_edicion: ahora, usuario_edicion: idOperador })
        .where(eq(pedidos.id_pedido, idPedido))
        .returning();

      // Completar el pedido despacha los productos que faltaban (queda quién y cuándo).
      if (dto.estado === 'listo') {
        await tx
          .update(pedidos_detalle)
          .set({ estado_kds: 'despachado', despachado_por: idOperador, despachado_el: ahora, fecha_edicion: ahora, usuario_edicion: idOperador })
          .where(
            and(
              eq(pedidos_detalle.id_pedido, idPedido),
              eq(pedidos_detalle.eliminado, false),
              ne(pedidos_detalle.estado_kds, 'despachado'),
            ),
          );
      }

      // Al anular, la mesa solo se libera si no quedan otros pedidos activos en ella.
      let mesaLiberada = false;
      if (dto.estado === 'anulado' && pedido.id_mesa) {
        const [otro] = await tx
          .select({ id: pedidos.id_pedido })
          .from(pedidos)
          .where(
            and(
              eq(pedidos.id_mesa, pedido.id_mesa),
              eq(pedidos.eliminado, false),
              ne(pedidos.id_pedido, idPedido),
              inArray(pedidos.estado, ['pendiente', 'en_preparacion', 'listo']),
            ),
          )
          .limit(1);

        if (!otro) {
          await tx
            .update(mesas)
            .set({ estado: 'libre', fecha_edicion: ahora, usuario_edicion: idOperador })
            .where(eq(mesas.id_mesa, pedido.id_mesa));
          mesaLiberada = true;
        }
      }

      if (dto.estado === 'anulado' || esReversion) {
        await this.audit.registrarEnTransaccion(tx, {
          id_usuario: idOperador,
          evento: dto.estado === 'anulado' ? 'PEDIDO_ANULADO' : 'PEDIDO_ESTADO_REVERTIDO',
          nivel_severidad: 'WARN',
          detalles: { id_pedido: idPedido, estado_anterior: estadoActual, estado_nuevo: dto.estado, motivo },
        });
      }

      return { fila, cambio: true, mesaLiberada, estadoAnterior: estadoActual };
    });

    // Tras confirmar: KDS y salón se enteran (ORD-012).
    if (resultado.cambio) {
      const reabierto = resultado.estadoAnterior === 'listo' && (dto.estado === 'en_preparacion' || dto.estado === 'pendiente');
      const tarjeta = reabierto ? await this.kds.obtenerTarjeta(idPedido) : null;
      if (tarjeta) this.bus.emitir('kds:nueva-comanda', tarjeta);
      else this.bus.emitir('kds:comanda-estado', { id_pedido: idPedido, estado: dto.estado });
      if (resultado.mesaLiberada && resultado.fila.id_mesa) {
        this.bus.emitir('mesa:estado-actualizado', { id_mesa: resultado.fila.id_mesa, estado: 'libre' });
      }
    }

    return resultado.fila;
  }
}
