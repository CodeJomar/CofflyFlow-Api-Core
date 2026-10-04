import { Injectable, Inject } from '@nestjs/common';
import { eq, and, sql, gte, lte, desc } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { turnos_caja, transacciones_caja } from '../../common/database/schema/transactions.schema';
import { pedidos, pedidos_detalle } from '../../common/database/schema/orders.schema';
import { mesas } from '../../common/database/schema/tables.schema';
import { DashboardFiltroDto } from './dto/dashboard-filtro.dto';
import { DateUtils } from '../../core/utils/date.utils';

@Injectable()
export class DashboardService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async obtenerMetricasConsolidadas(filtro: DashboardFiltroDto) {
    // 1. Determinar ventana de tiempo (por defecto el día de hoy)
    let fechaInicio: Date;
    let fechaFin: Date;

    if (filtro.fecha_inicio && filtro.fecha_fin) {
      fechaInicio = new Date(`${filtro.fecha_inicio}T00:00:00-05:00`);
      fechaFin = new Date(`${filtro.fecha_fin}T23:59:59.999-05:00`);
    } else {
      const ahora = DateUtils.ahoraUtc();
      fechaInicio = DateUtils.inicioDelDia(ahora);
      fechaFin = DateUtils.finDelDia(ahora);
    }

    // Condiciones base de transacciones de venta
    const condicionesVenta = [
      eq(transacciones_caja.tipo_movimiento, 'venta'),
      eq(transacciones_caja.eliminado, false),
    ];

    if (filtro.id_turno_caja) {
      condicionesVenta.push(eq(transacciones_caja.id_turno_caja, filtro.id_turno_caja));
    } else {
      condicionesVenta.push(
        gte(transacciones_caja.fecha_creacion, fechaInicio),
        lte(transacciones_caja.fecha_creacion, fechaFin),
      );
    }

    // 2. KPIs Financieros Principales
    const [resumenVentas] = await this.db
      .select({
        total_ventas: sql<string>`coalesce(sum(${transacciones_caja.monto}), 0)::text`,
        cantidad_transacciones: sql<number>`count(*)::int`,
      })
      .from(transacciones_caja)
      .where(and(...condicionesVenta));

    const totalVentasNum = Number(resumenVentas?.total_ventas || 0);
    const cantidadTransacciones = resumenVentas?.cantidad_transacciones || 0;
    const ticketPromedio =
      cantidadTransacciones > 0 ? (totalVentasNum / cantidadTransacciones).toFixed(2) : '0.00';

    // 3. Ventas Desglosadas por Método de Pago
    const porMetodoPago = await this.db
      .select({
        metodo: transacciones_caja.metodo_pago,
        total: sql<string>`sum(${transacciones_caja.monto})::text`,
        conteo: sql<number>`count(*)::int`,
      })
      .from(transacciones_caja)
      .where(and(...condicionesVenta))
      .groupBy(transacciones_caja.metodo_pago);

    const mixMetodos = porMetodoPago.map((m) => {
      const montoNum = Number(m.total);
      const porcentaje = totalVentasNum > 0 ? ((montoNum / totalVentasNum) * 100).toFixed(1) : '0.0';
      return {
        metodo: m.metodo,
        monto: montoNum.toFixed(2),
        transacciones: m.conteo,
        porcentaje: `${porcentaje}%`,
      };
    });

    // 4. Top 5 Productos Más Vendidos
    const topProductos = await this.db
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
          gte(pedidos.fecha_creacion, fechaInicio),
          lte(pedidos.fecha_creacion, fechaFin),
        ),
      )
      .groupBy(pedidos_detalle.id_producto, pedidos_detalle.nombre_producto)
      .orderBy(desc(sql`sum(${pedidos_detalle.cantidad})`))
      .limit(5);

    // 5. Ocupación del Salón en Tiempo Real
    const todasMesas = await this.db
      .select({
        id_mesa: mesas.id_mesa,
        estado: mesas.estado,
      })
      .from(mesas)
      .where(eq(mesas.eliminado, false));

    const totalMesas = todasMesas.length;
    const ocupadas = todasMesas.filter((m) => m.estado === 'ocupada').length;
    const libres = todasMesas.filter((m) => m.estado === 'libre').length;
    const porLimpiar = todasMesas.filter((m) => m.estado === 'por_limpiar').length;
    const porcentajeOcupacion =
      totalMesas > 0 ? (((ocupadas + porLimpiar) / totalMesas) * 100).toFixed(1) : '0.0';

    // 6. Tiempo Promedio de Preparación en Cocina/Barra (KDS)
    const [tiempoPromedio] = await this.db
      .select({
        minutos_promedio: sql<number>`
          coalesce(
            round(
              avg(
                extract(epoch from (${pedidos_detalle.despachado_el} - ${pedidos_detalle.fecha_creacion})) / 60
              )::numeric, 1
            ), 0
          )::float
        `,
      })
      .from(pedidos_detalle)
      .where(
        and(
          eq(pedidos_detalle.estado_kds, 'despachado'),
          sql`${pedidos_detalle.despachado_el} IS NOT NULL`,
          gte(pedidos_detalle.fecha_creacion, fechaInicio),
          lte(pedidos_detalle.fecha_creacion, fechaFin),
        ),
      );

    return {
      rango_consultado: {
        inicio: DateUtils.formatearFechaHora(fechaInicio),
        fin: DateUtils.formatearFechaHora(fechaFin),
      },
      kpis: {
        ventas_totales: totalVentasNum.toFixed(2),
        pedidos_atendidos: cantidadTransacciones,
        ticket_promedio: ticketPromedio,
        tiempo_promedio_preparacion_minutos: tiempoPromedio?.minutos_promedio || 0,
      },
      salon_en_vivo: {
        total_mesas: totalMesas,
        libres,
        ocupadas,
        por_limpiar: porLimpiar,
        porcentaje_ocupacion: `${porcentajeOcupacion}%`,
      },
      top_productos: topProductos.map((p) => ({
        ...p,
        total_recaudado: Number(p.total_recaudado).toFixed(2),
      })),
      distribucion_pagos: mixMetodos,
    };
  }
}