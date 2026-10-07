import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { turnos_caja, transacciones_caja } from '../../common/database/schema/transactions.schema';
import { pedidos, pedidos_detalle } from '../../common/database/schema/orders.schema';
import { mesas } from '../../common/database/schema/tables.schema';
import { DashboardFiltroDto } from './dto/dashboard-filtro.dto';
import { DateUtils } from '../../core/utils/date.utils';
import { aCentimos, desdeCentimos } from '../../common/validators/money.validator';
import { PermissionsService } from '../../common/security/permissions.service';
import { MODULO, ACCION } from '../../common/security/permission-matrix';
import { TransactionsService } from '../transactions/transactions.service';
import type { UsuarioAutenticado } from '../auth/session.service';

const MAX_DIAS_RANGO = 366;
const ESTADOS_PEDIDO = ['pendiente', 'en_preparacion', 'listo', 'pagado', 'anulado'] as const;
const ESTADOS_ACTIVOS = ['pendiente', 'en_preparacion', 'listo'];

interface Periodo {
  tipo: 'dia' | 'rango' | 'turno';
  inicio: Date;
  fin: Date;
  idTurno?: string;
}

/**
 * Dashboard del dueño (docs/domain/dashboard.md). SOLO LEE: agrega datos de Pedidos, Caja y Mesas, nunca es fuente
 * de verdad (DASH-002). Las métricas financieras salen de transacciones confirmadas del libro de caja (DASH-003),
 * se calculan en céntimos y siempre indican su período (DASH-006). El estado de caja solo se incluye si quien consulta
 * también tiene permiso sobre caja (DASH-005).
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly permisos: PermissionsService,
    private readonly transacciones: TransactionsService,
  ) {}

  async obtenerMetricasConsolidadas(filtro: DashboardFiltroDto, usuario: UsuarioAutenticado) {
    const periodo = await this.resolverPeriodo(filtro);

    // Condiciones del período, para el libro de caja y para los pedidos.
    // Libro del período. Las ventas son NETAS: cobros menos devoluciones (con signo en las sumas).
    const libro: SQL[] = [eq(transacciones_caja.eliminado, false)];
    const pedidosPeriodo: SQL[] = [eq(pedidos.eliminado, false)];
    if (periodo.idTurno) {
      libro.push(eq(transacciones_caja.id_turno_caja, periodo.idTurno));
      pedidosPeriodo.push(eq(pedidos.id_turno_caja, periodo.idTurno));
    } else {
      libro.push(gte(transacciones_caja.fecha_creacion, periodo.inicio), lte(transacciones_caja.fecha_creacion, periodo.fin));
      pedidosPeriodo.push(gte(pedidos.fecha_creacion, periodo.inicio), lte(pedidos.fecha_creacion, periodo.fin));
    }

    const ventas: SQL[] = [...libro, inArray(transacciones_caja.tipo_movimiento, ['venta', 'devolucion'])];
    const neto = sql`case when ${transacciones_caja.tipo_movimiento} = 'devolucion' then -${transacciones_caja.monto} else ${transacciones_caja.monto} end`;

    const [resumen, porMetodo, top, estadosPeriodo, activos, salon, preparacion, caja] = await Promise.all([
      // 1. Ventas netas del período, pedidos con cobro y total devuelto.
      this.db
        .select({
          total: sql<string>`coalesce(sum(${neto}), 0)::text`,
          cobros: sql<number>`count(distinct ${transacciones_caja.id_pedido}) filter (where ${transacciones_caja.tipo_movimiento} = 'venta')::int`,
          devuelto: sql<string>`coalesce(sum(${transacciones_caja.monto}) filter (where ${transacciones_caja.tipo_movimiento} = 'devolucion'), 0)::text`,
        })
        .from(transacciones_caja)
        .where(and(...ventas)),

      // 2. Ventas netas por método de pago.
      this.db
        .select({ metodo: transacciones_caja.metodo_pago, total: sql<string>`sum(${neto})::text`, cobros: sql<number>`(count(*) filter (where ${transacciones_caja.tipo_movimiento} = 'venta'))::int` })
        .from(transacciones_caja)
        .where(and(...ventas))
        .groupBy(transacciones_caja.metodo_pago),

      // 3. Top 5 productos vendidos: pedidos COBRADOS cuyo cobro cae en el período (no la fecha de creación del pedido).
      this.db
        .select({
          id_producto: pedidos_detalle.id_producto,
          nombre: pedidos_detalle.nombre_producto,
          unidades_vendidas: sql<number>`sum(${pedidos_detalle.cantidad})::int`,
          total_recaudado: sql<string>`sum(${pedidos_detalle.subtotal})::text`,
        })
        .from(pedidos_detalle)
        .innerJoin(pedidos, eq(pedidos_detalle.id_pedido, pedidos.id_pedido))
        .where(
          and(
            eq(pedidos.estado, 'pagado'),
            eq(pedidos.eliminado, false),
            eq(pedidos_detalle.eliminado, false),
            // Un pedido puede tener varios cobros: se filtra por existencia para no contar sus productos dos veces.
            inArray(
              pedidos.id_pedido,
              this.db
                .select({ id: transacciones_caja.id_pedido })
                .from(transacciones_caja)
                .where(and(...libro, eq(transacciones_caja.tipo_movimiento, 'venta'))),
            ),
          ),
        )
        .groupBy(pedidos_detalle.id_producto, pedidos_detalle.nombre_producto)
        .orderBy(desc(sql`sum(${pedidos_detalle.cantidad})`))
        .limit(5),

      // 4. Pedidos del período por estado.
      this.db
        .select({ estado: pedidos.estado, total: sql<number>`count(*)::int` })
        .from(pedidos)
        .where(and(...pedidosPeriodo))
        .groupBy(pedidos.estado),

      // 5. Pedidos activos AHORA (en vivo, independiente del período): requieren atención.
      this.db
        .select({ estado: pedidos.estado, total: sql<number>`count(*)::int` })
        .from(pedidos)
        .where(and(eq(pedidos.eliminado, false), inArray(pedidos.estado, ESTADOS_ACTIVOS)))
        .groupBy(pedidos.estado),

      // 6. Salón en vivo.
      this.db
        .select({ estado: mesas.estado, total: sql<number>`count(*)::int` })
        .from(mesas)
        .where(eq(mesas.eliminado, false))
        .groupBy(mesas.estado),

      // 7. Tiempo promedio de preparación (creación del ítem -> despacho) de lo despachado en el período.
      this.db
        .select({
          minutos: sql<number>`coalesce(round(avg(extract(epoch from (${pedidos_detalle.despachado_el} - ${pedidos_detalle.fecha_creacion})) / 60)::numeric, 1), 0)::float`,
        })
        .from(pedidos_detalle)
        .innerJoin(pedidos, eq(pedidos_detalle.id_pedido, pedidos.id_pedido))
        .where(
          and(
            eq(pedidos_detalle.estado_kds, 'despachado'),
            sql`${pedidos_detalle.despachado_el} IS NOT NULL`,
            periodo.idTurno
              ? eq(pedidos.id_turno_caja, periodo.idTurno)
              : and(gte(pedidos_detalle.despachado_el, periodo.inicio), lte(pedidos_detalle.despachado_el, periodo.fin)),
          ),
        ),

      // 8. Estado de caja actual, solo si quien consulta también puede ver caja.
      this.cajaActual(usuario),
    ]);

    const totalCentimos = aCentimos(resumen[0]?.total ?? '0');
    const cobros = resumen[0]?.cobros ?? 0;

    const cuenta = (filas: Array<{ estado: string | null; total: number }>, estado: string) => filas.find((f) => f.estado === estado)?.total ?? 0;
    const totalMesas = salon.reduce((n, f) => n + f.total, 0);
    // "Ocupada" incluye la que ya pidió la cuenta; 'por_limpiar' no tiene comensales.
    const ocupadas = cuenta(salon, 'ocupada') + cuenta(salon, 'por_cobrar');
    const ocupacion = totalMesas > 0 ? (ocupadas / totalMesas) * 100 : 0;

    return {
      periodo: {
        tipo: periodo.tipo,
        inicio: DateUtils.formatearFechaHora(periodo.inicio),
        fin: DateUtils.formatearFechaHora(periodo.fin),
      },
      kpis: {
        ventas_totales: desdeCentimos(totalCentimos),
        devoluciones: desdeCentimos(aCentimos(resumen[0]?.devuelto ?? '0')),
        pedidos_atendidos: cobros,
        ticket_promedio: desdeCentimos(cobros > 0 ? Math.round(totalCentimos / cobros) : 0),
        tiempo_promedio_preparacion_minutos: preparacion[0]?.minutos ?? 0,
      },
      pedidos: {
        // En vivo: lo que requiere atención ahora mismo.
        activos: {
          total: activos.reduce((n, f) => n + f.total, 0),
          pendientes: cuenta(activos, 'pendiente'),
          en_preparacion: cuenta(activos, 'en_preparacion'),
          listos_sin_cobrar: cuenta(activos, 'listo'),
        },
        // Del período consultado.
        del_periodo: Object.fromEntries(ESTADOS_PEDIDO.map((e) => [e, cuenta(estadosPeriodo, e)])),
      },
      salon_en_vivo: {
        total_mesas: totalMesas,
        libres: cuenta(salon, 'libre'),
        ocupadas: cuenta(salon, 'ocupada'),
        por_cobrar: cuenta(salon, 'por_cobrar'),
        por_limpiar: cuenta(salon, 'por_limpiar'),
        porcentaje_ocupacion: `${ocupacion.toFixed(1)}%`,
      },
      top_productos: top.map((p) => ({
        id_producto: p.id_producto,
        nombre: p.nombre,
        unidades_vendidas: p.unidades_vendidas,
        total_recaudado: desdeCentimos(aCentimos(p.total_recaudado)),
      })),
      distribucion_pagos: porMetodo
        .map((m) => ({ metodo: m.metodo, centimos: aCentimos(m.total), cobros: m.cobros }))
        .sort((a, b) => b.centimos - a.centimos)
        .map((m) => ({
          metodo: m.metodo,
          monto: desdeCentimos(m.centimos),
          cobros: m.cobros,
          porcentaje: `${totalCentimos > 0 ? ((m.centimos / totalCentimos) * 100).toFixed(1) : '0.0'}%`,
        })),
      caja_actual: caja,
    };
  }

  /** Período a consultar. Se valida aquí (no se ignora en silencio una fecha suelta ni se aceptan rangos enormes). */
  private async resolverPeriodo(filtro: DashboardFiltroDto): Promise<Periodo> {
    if (filtro.id_turno_caja) {
      const [turno] = await this.db
        .select({ apertura: turnos_caja.fecha_apertura, cierre: turnos_caja.fecha_cierre })
        .from(turnos_caja)
        .where(and(eq(turnos_caja.id_turno_caja, filtro.id_turno_caja), eq(turnos_caja.eliminado, false)))
        .limit(1);
      if (!turno) throw new NotFoundException('El turno de caja indicado no existe.');
      return { tipo: 'turno', inicio: turno.apertura ?? new Date(), fin: turno.cierre ?? new Date(), idTurno: filtro.id_turno_caja };
    }

    if (Boolean(filtro.fecha_inicio) !== Boolean(filtro.fecha_fin)) {
      throw new BadRequestException('Indica fecha_inicio y fecha_fin juntas (o ninguna, para ver el día de hoy).');
    }

    if (filtro.fecha_inicio && filtro.fecha_fin) {
      const inicio = this.limaInicio(filtro.fecha_inicio);
      const fin = this.limaFin(filtro.fecha_fin);
      if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
        throw new BadRequestException('Las fechas del filtro no son válidas.');
      }
      if (inicio > fin) throw new BadRequestException('fecha_inicio no puede ser posterior a fecha_fin.');
      if ((fin.getTime() - inicio.getTime()) / 86_400_000 > MAX_DIAS_RANGO) {
        throw new BadRequestException(`El rango no puede superar ${MAX_DIAS_RANGO} días.`);
      }
      return { tipo: 'rango', inicio, fin };
    }

    // Hoy, con el día calendario de Lima (no depende de la zona horaria del servidor).
    const hoy = DateUtils.formatearSoloFecha();
    return { tipo: 'dia', inicio: this.limaInicio(hoy), fin: this.limaFin(hoy) };
  }

  private limaInicio(ymd: string): Date {
    return new Date(`${ymd}T00:00:00.000-05:00`);
  }

  private limaFin(ymd: string): Date {
    return new Date(`${ymd}T23:59:59.999-05:00`);
  }

  private async cajaActual(usuario: UsuarioAutenticado) {
    if (!(await this.permisos.puede(usuario, MODULO.TRANSACTIONS, ACCION.LEER))) return null;
    try {
      const { turno, efectivo_esperado } = await this.transacciones.obtenerTurnoActual();
      return {
        abierta: true,
        abierta_por: turno.abierto_por,
        desde: DateUtils.formatearFechaHora(new Date(turno.fecha_apertura ?? Date.now())),
        monto_inicial: turno.monto_inicial,
        efectivo_esperado,
      };
    } catch (error) {
      if (error instanceof NotFoundException) return { abierta: false };
      throw error;
    }
  }
}
