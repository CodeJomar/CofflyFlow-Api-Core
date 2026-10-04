import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, sql, desc } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { turnos_caja, transacciones_caja } from '../../common/database/schema/transactions.schema';
import { pedidos } from '../../common/database/schema/orders.schema';
import { mesas } from '../../common/database/schema/tables.schema';
import { AperturaTurnoDto } from './dto/apertura-turno.dto';
import { CierreTurnoDto } from './dto/cierre-turno.dto';
import { MovimientoCajaDto } from './dto/movimiento-caja.dto';
import { CobroPedidoDto } from './dto/cobro-pedido.dto';
import { DateUtils } from '../../core/utils/date.utils';

@Injectable()
export class TransactionsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // =========================================================================
  // GESTIÓN DE TURNOS DE CAJA
  // =========================================================================

  async abrirTurno(dto: AperturaTurnoDto, idOperador: string) {
    // 1. Validar que el usuario no tenga ya un turno abierto
    const [turnoAbierto] = await this.db
      .select({ id: turnos_caja.id_turno_caja })
      .from(turnos_caja)
      .where(
        and(
          eq(turnos_caja.id_usuario_apertura, idOperador),
          eq(turnos_caja.estado, 'abierta'),
          eq(turnos_caja.eliminado, false),
        ),
      )
      .limit(1);

    if (turnoAbierto) {
      throw new ConflictException('Ya tienes un turno de caja abierto. Ciérralo antes de iniciar uno nuevo.');
    }

    const [nuevoTurno] = await this.db
      .insert(turnos_caja)
      .values({
        id_usuario_apertura: idOperador,
        monto_inicial: dto.monto_inicial,
        estado: 'abierta',
        usuario_creacion: idOperador,
        usuario_edicion: idOperador,
      })
      .returning();

    return nuevoTurno;
  }

  async obtenerTurnoActual(idOperador: string) {
    const [turno] = await this.db
      .select()
      .from(turnos_caja)
      .where(
        and(
          eq(turnos_caja.id_usuario_apertura, idOperador),
          eq(turnos_caja.estado, 'abierta'),
          eq(turnos_caja.eliminado, false),
        ),
      )
      .limit(1);

    if (!turno) {
      throw new NotFoundException('No tienes ningún turno de caja abierto actualmente.');
    }

    // Calcular totales de movimientos del turno en curso
    const movimientos = await this.db
      .select({
        tipo_movimiento: transacciones_caja.tipo_movimiento,
        metodo_pago: transacciones_caja.metodo_pago,
        total: sql<string>`sum(${transacciones_caja.monto})::text`,
      })
      .from(transacciones_caja)
      .where(
        and(
          eq(transacciones_caja.id_turno_caja, turno.id_turno_caja),
          eq(transacciones_caja.eliminado, false),
        ),
      )
      .groupBy(transacciones_caja.tipo_movimiento, transacciones_caja.metodo_pago);

    return {
      turno,
      resumen_movimientos: movimientos,
    };
  }

  async cerrarTurno(idTurno: string, dto: CierreTurnoDto, idOperador: string) {
    const [turno] = await this.db
      .select()
      .from(turnos_caja)
      .where(and(eq(turnos_caja.id_turno_caja, idTurno), eq(turnos_caja.eliminado, false)))
      .limit(1);

    if (!turno) {
      throw new NotFoundException('El turno de caja especificado no existe.');
    }

    if (turno.estado !== 'abierta') {
      throw new BadRequestException('El turno de caja ya se encuentra cerrado.');
    }

    // 1. Obtener todas las transacciones del turno para arqueo exacto
    const movimientos = await this.db
      .select()
      .from(transacciones_caja)
      .where(
        and(
          eq(transacciones_caja.id_turno_caja, idTurno),
          eq(transacciones_caja.eliminado, false),
        ),
      );

    // Sumar solo movimientos que afectan el efectivo físico en gaveta
    let totalEfectivoIngresado = 0;
    for (const mov of movimientos) {
      const montoNum = Number(mov.monto);
      if (mov.metodo_pago === 'efectivo') {
        if (mov.tipo_movimiento === 'venta' || mov.tipo_movimiento === 'ingreso_manual') {
          totalEfectivoIngresado += montoNum;
        } else if (mov.tipo_movimiento === 'retiro_manual' || mov.tipo_movimiento === 'devolucion') {
          totalEfectivoIngresado -= montoNum;
        }
      }
    }

    const montoInicial = Number(turno.monto_inicial);
    const montoCalculado = montoInicial + totalEfectivoIngresado;
    const montoReal = Number(dto.monto_final_real);
    const diferencia = montoReal - montoCalculado;

    // Si diferencia es 0 -> cerrada limpia, si hay descuadre -> 'descuadre'
    const estadoFinal = Math.abs(diferencia) < 0.01 ? 'cerrada' : 'descuadre';

    const [turnoActualizado] = await this.db
      .update(turnos_caja)
      .set({
        id_usuario_cierre: idOperador,
        fecha_cierre: DateUtils.ahoraUtc(),
        monto_final_calculado: montoCalculado.toFixed(2),
        monto_final_real: montoReal.toFixed(2),
        diferencia: diferencia.toFixed(2),
        estado: estadoFinal,
        notas_cierre: dto.notas_cierre ?? null,
        fecha_edicion: DateUtils.ahoraUtc(),
        usuario_edicion: idOperador,
      })
      .where(eq(turnos_caja.id_turno_caja, idTurno))
      .returning();

    return turnoActualizado;
  }

  // =========================================================================
  // MOVIMIENTOS MANUALES DE CAJA
  // =========================================================================

  async registrarMovimiento(dto: MovimientoCajaDto, idOperador: string) {
    const [turno] = await this.db
      .select({ id: turnos_caja.id_turno_caja, estado: turnos_caja.estado })
      .from(turnos_caja)
      .where(and(eq(turnos_caja.id_turno_caja, dto.id_turno_caja), eq(turnos_caja.eliminado, false)))
      .limit(1);

    if (!turno || turno.estado !== 'abierta') {
      throw new BadRequestException('El turno de caja no existe o ya está cerrado.');
    }

    const [movimiento] = await this.db
      .insert(transacciones_caja)
      .values({
        id_turno_caja: dto.id_turno_caja,
        tipo_movimiento: dto.tipo_movimiento,
        metodo_pago: dto.metodo_pago,
        monto: dto.monto,
        notas: dto.notas ?? null,
        usuario_creacion: idOperador,
        usuario_edicion: idOperador,
      })
      .returning();

    return movimiento;
  }

  // =========================================================================
  // COBRO DE COMANDAS Y LIBERACIÓN DE MESAS
  // =========================================================================

  async cobrarPedido(dto: CobroPedidoDto, idOperador: string) {
    // 1. Validar pedido
    const [pedido] = await this.db
      .select()
      .from(pedidos)
      .where(and(eq(pedidos.id_pedido, dto.id_pedido), eq(pedidos.eliminado, false)))
      .limit(1);

    if (!pedido) {
      throw new NotFoundException('El pedido especificado no existe.');
    }

    if (pedido.estado === 'pagado') {
      throw new ConflictException('El pedido ya fue cobrado anteriormente.');
    }

    if (pedido.estado === 'anulado') {
      throw new BadRequestException('No se puede cobrar un pedido que ha sido anulado.');
    }

    // 2. Validar que el turno de caja esté abierto
    const [turno] = await this.db
      .select({ id: turnos_caja.id_turno_caja, estado: turnos_caja.estado })
      .from(turnos_caja)
      .where(and(eq(turnos_caja.id_turno_caja, dto.id_turno_caja), eq(turnos_caja.eliminado, false)))
      .limit(1);

    if (!turno || turno.estado !== 'abierta') {
      throw new BadRequestException('El turno de caja no está abierto.');
    }

    // 3. Registrar transacción de cobro
    const [transaccion] = await this.db
      .insert(transacciones_caja)
      .values({
        id_turno_caja: dto.id_turno_caja,
        id_pedido: dto.id_pedido,
        tipo_movimiento: 'venta',
        metodo_pago: dto.metodo_pago,
        monto: dto.monto,
        notas: dto.notas ?? null,
        usuario_creacion: idOperador,
        usuario_edicion: idOperador,
      })
      .returning();

    // 4. Actualizar estado del pedido a 'pagado'
    await this.db
      .update(pedidos)
      .set({
        estado: 'pagado',
        fecha_edicion: DateUtils.ahoraUtc(),
        usuario_edicion: idOperador,
      })
      .where(eq(pedidos.id_pedido, dto.id_pedido));

    // 5. Si tenía mesa asignada en salón, pasarla a 'por_limpiar' (Esperando limpieza de KDS)
    if (pedido.id_mesa) {
      await this.db
        .update(mesas)
        .set({
          estado: 'por_limpiar', // Pasa al estado visto en la Imagen 1
          fecha_edicion: DateUtils.ahoraUtc(),
          usuario_edicion: idOperador,
        })
        .where(eq(mesas.id_mesa, pedido.id_mesa));
    }

    // 6. Cálculo de desglose con IGV 18% para el comprobante
    const totalCobrado = Number(dto.monto);
    const subtotalSinIgv = totalCobrado / 1.18;
    const igvCalculado = totalCobrado - subtotalSinIgv;

    return {
      transaccion,
      pedido_id: pedido.id_pedido,
      desglose: {
        subtotal_sin_igv: subtotalSinIgv.toFixed(2),
        igv_18: igvCalculado.toFixed(2),
        total_cobrado: totalCobrado.toFixed(2),
        metodo_pago: dto.metodo_pago,
      },
    };
  }

  /**
   * Historial de transacciones de venta y movimientos
   */
  async listarHistorial(idTurnoCaja?: string) {
    const condiciones = [eq(transacciones_caja.eliminado, false)];
    if (idTurnoCaja) {
      condiciones.push(eq(transacciones_caja.id_turno_caja, idTurnoCaja));
    }

    return this.db
      .select()
      .from(transacciones_caja)
      .where(and(...condiciones))
      .orderBy(desc(transacciones_caja.fecha_creacion))
      .limit(100);
  }
}