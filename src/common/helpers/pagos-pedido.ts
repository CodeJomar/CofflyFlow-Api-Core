import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../database/database.provider';
import { transacciones_caja } from '../database/schema/transactions.schema';
import { aCentimos } from '../validators/money.validator';

export type EstadoPago = 'pendiente' | 'parcial' | 'pagado' | 'devuelto_parcial' | 'devuelto';

/** Lo cobrado y lo devuelto de un pedido, en céntimos, leído del libro de caja (única fuente de verdad). */
export async function totalesPagos(
  ejecutor: Pick<DrizzleDb, 'select'>,
  idPedido: string,
): Promise<{ pagadoCentimos: number; devueltoCentimos: number }> {
  const filas = await ejecutor
    .select({ tipo: transacciones_caja.tipo_movimiento, total: sql<string>`coalesce(sum(${transacciones_caja.monto}), 0)::text` })
    .from(transacciones_caja)
    .where(
      and(
        eq(transacciones_caja.id_pedido, idPedido),
        eq(transacciones_caja.eliminado, false),
        inArray(transacciones_caja.tipo_movimiento, ['venta', 'devolucion']),
      ),
    )
    .groupBy(transacciones_caja.tipo_movimiento);

  let pagado = 0;
  let devuelto = 0;
  for (const f of filas) {
    if (f.tipo === 'venta') pagado = aCentimos(f.total);
    else devuelto = aCentimos(f.total);
  }
  return { pagadoCentimos: pagado, devueltoCentimos: devuelto };
}

export function estadoPago(totalCentimos: number, pagadoCentimos: number, devueltoCentimos: number): EstadoPago {
  if (pagadoCentimos <= 0) return 'pendiente';
  if (pagadoCentimos < totalCentimos) return devueltoCentimos > 0 ? 'devuelto_parcial' : 'parcial';
  if (devueltoCentimos <= 0) return 'pagado';
  return devueltoCentimos >= pagadoCentimos ? 'devuelto' : 'devuelto_parcial';
}
