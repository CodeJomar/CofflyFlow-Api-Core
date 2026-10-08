import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and, desc, inArray, or, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { turnos_caja, transacciones_caja } from '../../common/database/schema/transactions.schema';
import { pedidos } from '../../common/database/schema/orders.schema';
import { mesas } from '../../common/database/schema/tables.schema';
import { usuarios } from '../../common/database/schema/users.schema';
import { AperturaTurnoDto } from './dto/apertura-turno.dto';
import { CierreTurnoDto } from './dto/cierre-turno.dto';
import { MovimientoCajaDto } from './dto/movimiento-caja.dto';
import { CobroPedidoDto } from './dto/cobro-pedido.dto';
import { AjusteCajaDto } from './dto/ajuste-caja.dto';
import { DevolucionDto } from './dto/devolucion.dto';
import { totalesPagos, estadoPago } from '../../common/helpers/pagos-pedido';
import { DateUtils } from '../../core/utils/date.utils';
import { aCentimos, desdeCentimos } from '../../common/validators/money.validator';
import { RealtimeBus } from '../../common/realtime/realtime-bus.service';
import { AuditLoggerService } from '../../common/audit/audit-logger.service';
import type { UsuarioAutenticado } from '../auth/session.service';

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

const IGV = 1.18;

/** Valor en céntimos de cada denominación del arqueo (billetes y monedas en soles). */
const DENOMINACIONES_CENTIMOS: Record<string, number> = {
  b200: 20000,
  b100: 10000,
  b50: 5000,
  b20: 2000,
  b10: 1000,
  m5: 500,
  m2: 200,
  m1: 100,
  m050: 50,
  m020: 20,
  m010: 10,
};

function esViolacionUnica(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/**
 * Caja y cobros (docs/domain/transactions.md). Reglas de integridad, todas en servidor:
 *  - TRX-001  Una sola caja: un único turno abierto en todo el local (índice único en la base).
 *  - TRX-003  Cualquier usuario con permiso de cobro puede cobrar dentro del turno abierto; cada transacción guarda
 *             quién la registró. El turno lo cierra quien lo abrió (o el OWNER), que responde por el arqueo.
 *  - TRX-005  Los movimientos manuales y los ajustes exigen motivo.
 *  - TRX-008  Un turno cerrado es inmutable: las correcciones son AJUSTES auditables (transacción nueva marcada).
 *  - TRX-009  Toda operación sobre varias filas corre en UNA transacción con bloqueo de fila (FOR UPDATE).
 *  - TRX-010  El libro de transacciones no se borra ni se edita (triggers en la base).
 *  El monto cobrado debe coincidir exactamente con el total del pedido; los importes se calculan en céntimos.
 */
@Injectable()
export class TransactionsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly audit: AuditLoggerService,
    private readonly bus: RealtimeBus,
  ) {}

  // =========================================================================
  // TURNOS
  // =========================================================================

  async abrirTurno(dto: AperturaTurnoDto, usuario: UsuarioAutenticado) {
    try {
      const turno = await this.db.transaction(async (tx) => {
        const [abierto] = await tx
          .select({ nombre: usuarios.nombre })
          .from(turnos_caja)
          .innerJoin(usuarios, eq(usuarios.id_usuario, turnos_caja.id_usuario_apertura))
          .where(and(eq(turnos_caja.estado, 'abierta'), eq(turnos_caja.eliminado, false)))
          .limit(1);
        if (abierto) {
          throw new ConflictException(`Ya hay un turno de caja abierto (abierto por ${abierto.nombre}). Debe cerrarse antes de abrir otro.`);
        }

        const [nuevo] = await tx
          .insert(turnos_caja)
          .values({
            id_usuario_apertura: usuario.id_usuario,
            monto_inicial: dto.monto_inicial,
            nota_apertura: dto.nota_apertura?.trim() || null,
            estado: 'abierta',
            usuario_creacion: usuario.id_usuario,
            usuario_edicion: usuario.id_usuario,
          })
          .returning();
        return nuevo;
      });

      this.audit.registrarEvento({
        id_usuario: usuario.id_usuario,
        evento: 'TURNO_ABIERTO',
        detalles: { id_turno_caja: turno.id_turno_caja, monto_inicial: turno.monto_inicial },
      });
      return turno;
    } catch (error) {
      // Dos aperturas simultáneas: el índice único parcial de la base impide la segunda.
      if (esViolacionUnica(error)) {
        throw new ConflictException('Ya hay un turno de caja abierto. Debe cerrarse antes de abrir otro.');
      }
      throw error;
    }
  }

  /** El turno de caja abierto del local (o 404 si la caja está cerrada), con su resumen y el efectivo esperado. */
  async obtenerTurnoActual() {
    const [fila] = await this.db
      .select({
        id_turno_caja: turnos_caja.id_turno_caja,
        fecha_apertura: turnos_caja.fecha_apertura,
        monto_inicial: turnos_caja.monto_inicial,
        nota_apertura: turnos_caja.nota_apertura,
        estado: turnos_caja.estado,
        abierto_por: usuarios.nombre,
      })
      .from(turnos_caja)
      .innerJoin(usuarios, eq(usuarios.id_usuario, turnos_caja.id_usuario_apertura))
      .where(and(eq(turnos_caja.estado, 'abierta'), eq(turnos_caja.eliminado, false)))
      .limit(1);

    if (!fila) {
      throw new NotFoundException('La caja está cerrada: no hay ningún turno abierto.');
    }

    const movimientos = await this.db
      .select({ tipo_movimiento: transacciones_caja.tipo_movimiento, metodo_pago: transacciones_caja.metodo_pago, monto: transacciones_caja.monto })
      .from(transacciones_caja)
      .where(and(eq(transacciones_caja.id_turno_caja, fila.id_turno_caja), eq(transacciones_caja.eliminado, false)));

    // Resumen por tipo y método, en céntimos (sin sumar floats).
    const resumen = new Map<string, { tipo_movimiento: string; metodo_pago: string; centimos: number; transacciones: number }>();
    for (const m of movimientos) {
      const clave = `${m.tipo_movimiento}|${m.metodo_pago}`;
      const r = resumen.get(clave) ?? { tipo_movimiento: m.tipo_movimiento, metodo_pago: m.metodo_pago, centimos: 0, transacciones: 0 };
      r.centimos += aCentimos(m.monto);
      r.transacciones += 1;
      resumen.set(clave, r);
    }

    return {
      turno: fila,
      resumen_movimientos: [...resumen.values()].map((r) => ({
        tipo_movimiento: r.tipo_movimiento,
        metodo_pago: r.metodo_pago,
        total: desdeCentimos(r.centimos),
        transacciones: r.transacciones,
      })),
      efectivo_esperado: desdeCentimos(aCentimos(fila.monto_inicial) + this.efectivoNeto(movimientos)),
    };
  }

  /** Efectivo que entra o sale de la gaveta según los movimientos (TRX arqueo): ventas e ingresos suman; retiros y devoluciones restan. */
  private efectivoNeto(movs: Array<{ tipo_movimiento: string; metodo_pago: string; monto: string }>): number {
    let neto = 0;
    for (const m of movs) {
      if (m.metodo_pago !== 'efectivo') continue;
      const monto = aCentimos(m.monto);
      if (m.tipo_movimiento === 'venta' || m.tipo_movimiento === 'ingreso_manual') neto += monto;
      else if (m.tipo_movimiento === 'retiro_manual' || m.tipo_movimiento === 'devolucion') neto -= monto;
    }
    return neto;
  }

  /** Obtiene y BLOQUEA el turno abierto del local; si se indica un id, debe coincidir. Serializa cobros, movimientos y cierre. */
  private async turnoAbiertoBloqueado(tx: Tx, idEsperado?: string) {
    const [turno] = await tx
      .select()
      .from(turnos_caja)
      .where(and(eq(turnos_caja.estado, 'abierta'), eq(turnos_caja.eliminado, false)))
      .for('update');

    if (!turno) {
      throw new ConflictException('La caja está cerrada: abre un turno de caja primero.');
    }
    if (idEsperado && idEsperado !== turno.id_turno_caja) {
      throw new BadRequestException('El turno indicado no es el turno de caja abierto.');
    }
    return turno;
  }

  async cerrarTurno(idTurno: string, dto: CierreTurnoDto, usuario: UsuarioAutenticado) {
    const turnoCerrado = await this.db.transaction(async (tx) => {
      const [turno] = await tx
        .select()
        .from(turnos_caja)
        .where(and(eq(turnos_caja.id_turno_caja, idTurno), eq(turnos_caja.eliminado, false)))
        .for('update');

      if (!turno) throw new NotFoundException('El turno de caja especificado no existe.');
      if (turno.estado !== 'abierta') throw new BadRequestException('El turno de caja ya se encuentra cerrado.');
      if (usuario.tipo_cuenta !== 'OWNER' && turno.id_usuario_apertura !== usuario.id_usuario) {
        throw new ForbiddenException('Solo quien abrió el turno de caja (o el propietario) puede cerrarlo.');
      }

      // Todas las transacciones del turno, con el turno bloqueado: nadie añade más durante el arqueo.
      const movimientos = await tx
        .select()
        .from(transacciones_caja)
        .where(and(eq(transacciones_caja.id_turno_caja, idTurno), eq(transacciones_caja.eliminado, false)));

      const esperado = aCentimos(turno.monto_inicial) + this.efectivoNeto(movimientos);
      const contado = aCentimos(dto.monto_final_real);
      const diferencia = contado - esperado;
      const conteo = this.validarConteo(dto.conteo, contado);

      const [actualizado] = await tx
        .update(turnos_caja)
        .set({
          id_usuario_cierre: usuario.id_usuario,
          fecha_cierre: DateUtils.ahoraUtc(),
          monto_final_calculado: desdeCentimos(esperado),
          monto_final_real: desdeCentimos(contado),
          diferencia: desdeCentimos(diferencia),
          estado: diferencia === 0 ? 'cerrada' : 'descuadre',
          notas_cierre: dto.notas_cierre ?? null,
          conteo_cierre: conteo,
          fecha_edicion: DateUtils.ahoraUtc(),
          usuario_edicion: usuario.id_usuario,
        })
        .where(eq(turnos_caja.id_turno_caja, idTurno))
        .returning();
      return actualizado;
    });

    this.audit.registrarEvento({
      id_usuario: usuario.id_usuario,
      evento: 'TURNO_CERRADO',
      nivel_severidad: turnoCerrado.estado === 'descuadre' ? 'WARN' : 'INFO',
      detalles: {
        id_turno_caja: turnoCerrado.id_turno_caja,
        esperado: turnoCerrado.monto_final_calculado,
        contado: turnoCerrado.monto_final_real,
        diferencia: turnoCerrado.diferencia,
      },
    });
    return turnoCerrado;
  }

  /** Valida el conteo por denominación y comprueba que sume lo declarado como monto contado. */
  private validarConteo(conteo: Record<string, number> | undefined, contadoCentimos: number): Record<string, number> | null {
    if (!conteo) return null;
    let suma = 0;
    const limpio: Record<string, number> = {};
    for (const [clave, cantidad] of Object.entries(conteo)) {
      const valor = DENOMINACIONES_CENTIMOS[clave];
      if (valor === undefined) throw new BadRequestException(`Denominación no válida en el conteo: ${clave}.`);
      if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > 100_000) {
        throw new BadRequestException(`La cantidad de ${clave} debe ser un entero entre 0 y 100000.`);
      }
      if (cantidad > 0) limpio[clave] = cantidad;
      suma += valor * cantidad;
    }
    if (suma !== contadoCentimos) {
      throw new BadRequestException(`El conteo suma S/ ${desdeCentimos(suma)} y no coincide con el monto contado (S/ ${desdeCentimos(contadoCentimos)}).`);
    }
    return limpio;
  }

  /**
   * Turnos de caja (más recientes primero) con quién los abrió y cerró y lo vendido en cada uno.
   * El propietario ve todos; los demás, los que abrieron ellos y el turno abierto.
   */
  async listarTurnos(usuario: UsuarioAutenticado, pagina: number, limite: number) {
    const condiciones = [eq(turnos_caja.eliminado, false)];
    if (usuario.tipo_cuenta !== 'OWNER') {
      condiciones.push(or(eq(turnos_caja.id_usuario_apertura, usuario.id_usuario), eq(turnos_caja.estado, 'abierta'))!);
    }
    const donde = and(...condiciones);

    const [{ total }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(turnos_caja).where(donde);

    const apertura = alias(usuarios, 'u_apertura');
    const cierre = alias(usuarios, 'u_cierre');
    const items = await this.db
      .select({
        id_turno_caja: turnos_caja.id_turno_caja,
        fecha_apertura: turnos_caja.fecha_apertura,
        fecha_cierre: turnos_caja.fecha_cierre,
        monto_inicial: turnos_caja.monto_inicial,
        monto_final_calculado: turnos_caja.monto_final_calculado,
        monto_final_real: turnos_caja.monto_final_real,
        diferencia: turnos_caja.diferencia,
        estado: turnos_caja.estado,
        nota_apertura: turnos_caja.nota_apertura,
        notas_cierre: turnos_caja.notas_cierre,
        conteo_cierre: turnos_caja.conteo_cierre,
        abierto_por: apertura.nombre,
        cerrado_por: cierre.nombre,
        total_ventas: sql<string>`(select coalesce(sum(t.monto), 0)::text from transacciones_caja t where t.id_turno_caja = ${turnos_caja.id_turno_caja} and t.tipo_movimiento = 'venta' and t.eliminado = false)`,
        total_devoluciones: sql<string>`(select coalesce(sum(t.monto), 0)::text from transacciones_caja t where t.id_turno_caja = ${turnos_caja.id_turno_caja} and t.tipo_movimiento = 'devolucion' and t.eliminado = false)`,
        movimientos: sql<number>`(select count(*)::int from transacciones_caja t where t.id_turno_caja = ${turnos_caja.id_turno_caja} and t.eliminado = false)`,
      })
      .from(turnos_caja)
      .innerJoin(apertura, eq(apertura.id_usuario, turnos_caja.id_usuario_apertura))
      .leftJoin(cierre, eq(cierre.id_usuario, turnos_caja.id_usuario_cierre))
      .where(donde)
      .orderBy(desc(turnos_caja.fecha_apertura))
      .limit(limite)
      .offset((pagina - 1) * limite);

    return { items, total: Number(total) };
  }

  // =========================================================================
  // MOVIMIENTOS MANUALES Y AJUSTES
  // =========================================================================

  async registrarMovimiento(dto: MovimientoCajaDto, usuario: UsuarioAutenticado) {
    const movimiento = await this.db.transaction(async (tx) => {
      const turno = await this.turnoAbiertoBloqueado(tx, dto.id_turno_caja);
      const [fila] = await tx
        .insert(transacciones_caja)
        .values({
          id_turno_caja: turno.id_turno_caja,
          tipo_movimiento: dto.tipo_movimiento,
          metodo_pago: dto.metodo_pago,
          monto: dto.monto,
          notas: dto.notas.trim(), // motivo obligatorio (TRX-005)
          usuario_creacion: usuario.id_usuario,
          usuario_edicion: usuario.id_usuario,
        })
        .returning();
      return fila;
    });

    this.audit.registrarEvento({
      id_usuario: usuario.id_usuario,
      evento: 'MOVIMIENTO_CAJA',
      detalles: { tipo: movimiento.tipo_movimiento, metodo: movimiento.metodo_pago, monto: movimiento.monto },
    });
    return movimiento;
  }

  /** TRX-008: corrección auditable sobre un turno cerrado. No modifica el turno; añade una transacción marcada como ajuste. */
  async registrarAjuste(idTurno: string, dto: AjusteCajaDto, usuario: UsuarioAutenticado) {
    const ajuste = await this.db.transaction(async (tx) => {
      const [turno] = await tx
        .select({ id: turnos_caja.id_turno_caja, estado: turnos_caja.estado })
        .from(turnos_caja)
        .where(and(eq(turnos_caja.id_turno_caja, idTurno), eq(turnos_caja.eliminado, false)))
        .for('share');
      if (!turno) throw new NotFoundException('El turno de caja especificado no existe.');
      if (turno.estado === 'abierta') {
        throw new BadRequestException('El turno sigue abierto: registra un movimiento manual en lugar de un ajuste.');
      }

      const [fila] = await tx
        .insert(transacciones_caja)
        .values({
          id_turno_caja: idTurno,
          tipo_movimiento: dto.tipo_movimiento,
          metodo_pago: dto.metodo_pago,
          monto: dto.monto,
          notas: dto.motivo.trim(),
          es_ajuste: true,
          usuario_creacion: usuario.id_usuario,
          usuario_edicion: usuario.id_usuario,
        })
        .returning();
      return fila;
    });

    this.audit.registrarEvento({
      id_usuario: usuario.id_usuario,
      evento: 'AJUSTE_CAJA',
      nivel_severidad: 'WARN',
      detalles: { id_turno_caja: idTurno, tipo: ajuste.tipo_movimiento, metodo: ajuste.metodo_pago, monto: ajuste.monto, motivo: ajuste.notas },
    });
    return ajuste;
  }

  // =========================================================================
  // COBRO DE COMANDAS (mixto y parcial) Y LIBERACIÓN DE MESAS
  // =========================================================================

  /**
   * Registra uno o varios pagos de un pedido. Admite pago mixto (varias líneas con distinto método) y pago parcial
   * (cada comensal paga lo suyo): el pedido pasa a 'pagado' cuando lo cobrado cubre su total. Con `claveIdempotencia`
   * (obligatoria) un doble clic o un reintento devuelve el mismo resultado sin cobrar dos veces.
   */
  async cobrarPedido(dto: CobroPedidoDto, usuario: UsuarioAutenticado, claveIdempotencia: string) {
    const lineas = dto.pagos.map((p) => ({ metodo: p.metodo_pago, centimos: aCentimos(p.monto) }));

    const previo = await this.cobroPrevio(usuario.id_usuario, claveIdempotencia, dto.id_pedido, lineas);
    if (previo) return { ...previo, reutilizado: true };

    try {
      const cobro = await this.db.transaction(async (tx) => {
        // 1. Pedido bloqueado: dos cobros simultáneos del mismo pedido (dos comensales) se serializan.
        const [pedido] = await tx
          .select()
          .from(pedidos)
          .where(and(eq(pedidos.id_pedido, dto.id_pedido), eq(pedidos.eliminado, false)))
          .for('update');

        if (!pedido) throw new NotFoundException('El pedido especificado no existe.');
        if (pedido.estado === 'pagado') throw new ConflictException('El pedido ya fue cobrado completamente.');
        if (pedido.estado === 'anulado') throw new BadRequestException('No se puede cobrar un pedido que ha sido anulado.');

        // 2. El cobro entra al turno de caja abierto (la caja debe estar abierta).
        const turno = await this.turnoAbiertoBloqueado(tx, dto.id_turno_caja);

        // 3. Lo cobrado nunca supera el saldo pendiente (el servidor fija el total; el cliente solo reparte).
        const total = aCentimos(pedido.total_calculado ?? '0');
        const { pagadoCentimos } = await totalesPagos(tx, pedido.id_pedido);
        const saldo = total - pagadoCentimos;
        const suma = lineas.reduce((acc, l) => acc + l.centimos, 0);
        if (saldo <= 0) throw new ConflictException('El pedido ya fue cobrado completamente.');
        if (suma > saldo) {
          throw new BadRequestException(`El cobro (S/ ${desdeCentimos(suma)}) supera el saldo pendiente (S/ ${desdeCentimos(saldo)}).`);
        }

        // 4. Una fila del libro por línea de pago, cada una con su clave derivada (<clave>#<n>).
        const filas = await tx
          .insert(transacciones_caja)
          .values(
            lineas.map((l, i) => ({
              id_turno_caja: turno.id_turno_caja,
              id_pedido: pedido.id_pedido,
              tipo_movimiento: 'venta',
              metodo_pago: l.metodo,
              monto: desdeCentimos(l.centimos),
              notas: dto.notas ?? null,
              clave_idempotencia: `${claveIdempotencia}#${i}`,
              usuario_creacion: usuario.id_usuario,
              usuario_edicion: usuario.id_usuario,
            })),
          )
          .returning();

        // 5. Si el saldo queda cubierto: cierre financiero del pedido y mesa a 'por_limpiar' (si no tiene otros pedidos).
        let completado = false;
        let mesaPorLimpiar = false;
        if (suma === saldo) {
          completado = true;
          await tx
            .update(pedidos)
            .set({ estado: 'pagado', fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: usuario.id_usuario })
            .where(eq(pedidos.id_pedido, pedido.id_pedido));

          if (pedido.id_mesa) {
            const [otroActivo] = await tx
              .select({ id: pedidos.id_pedido })
              .from(pedidos)
              .where(
                and(
                  eq(pedidos.id_mesa, pedido.id_mesa),
                  eq(pedidos.eliminado, false),
                  ne(pedidos.id_pedido, pedido.id_pedido),
                  inArray(pedidos.estado, ['pendiente', 'en_preparacion', 'listo']),
                ),
              )
              .limit(1);
            if (!otroActivo) {
              await tx
                .update(mesas)
                .set({ estado: 'por_limpiar', fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: usuario.id_usuario })
                .where(eq(mesas.id_mesa, pedido.id_mesa));
              mesaPorLimpiar = true;
            }
          }
        }

        const resumen = this.resumenCobro(pedido.id_pedido, total, pagadoCentimos + suma, 0, filas);
        return { resumen, id_mesa: pedido.id_mesa, completado, mesaPorLimpiar };
      });

      // Tras confirmar: si el pedido quedó pagado sale del KDS y la mesa pasa a limpieza; en todo caso las pantallas se enteran.
      if (cobro.completado) this.bus.emitir('kds:comanda-estado', { id_pedido: cobro.resumen.pedido_id, estado: 'pagado' });
      this.bus.emitir('pedido:pago-actualizado', { id_pedido: cobro.resumen.pedido_id, estado_pago: cobro.resumen.estado_pago });
      if (cobro.id_mesa && cobro.mesaPorLimpiar) {
        this.bus.emitir('mesa:estado-actualizado', { id_mesa: cobro.id_mesa, estado: 'por_limpiar' });
      }
      return { ...cobro.resumen, reutilizado: false };
    } catch (error) {
      // Dos peticiones con la misma clave a la vez: la segunda recibe el resultado de la primera.
      if (esViolacionUnica(error)) {
        const ganador = await this.cobroPrevio(usuario.id_usuario, claveIdempotencia, dto.id_pedido, lineas);
        if (ganador) return { ...ganador, reutilizado: true };
        throw new ConflictException('El pedido ya fue cobrado anteriormente.');
      }
      throw error;
    }
  }

  /** Si esta clave ya registró un cobro, devuelve su resultado; si la misma clave trae otro contenido, 409. */
  private async cobroPrevio(
    idUsuario: string,
    clave: string,
    idPedido: string,
    lineas: Array<{ metodo: string; centimos: number }>,
  ) {
    const filas = await this.db
      .select()
      .from(transacciones_caja)
      .where(
        and(
          eq(transacciones_caja.usuario_creacion, idUsuario),
          sql`starts_with(${transacciones_caja.clave_idempotencia}, ${clave + '#'})`,
        ),
      )
      .orderBy(transacciones_caja.clave_idempotencia);
    if (filas.length === 0) return null;

    const igual =
      filas.length === lineas.length &&
      filas.every((f) => f.id_pedido === idPedido && f.tipo_movimiento === 'venta') &&
      lineas.every((l) => {
        const fila = filas.find((f) => f.clave_idempotencia === `${clave}#${lineas.indexOf(l)}`);
        return fila && fila.metodo_pago === l.metodo && aCentimos(fila.monto) === l.centimos;
      });
    if (!igual) throw new ConflictException('Esa Idempotency-Key ya se usó con un cobro distinto. Genera una clave nueva.');

    const [pedido] = await this.db.select().from(pedidos).where(eq(pedidos.id_pedido, idPedido));
    const { pagadoCentimos, devueltoCentimos } = await totalesPagos(this.db, idPedido);
    return this.resumenCobro(idPedido, aCentimos(pedido?.total_calculado ?? '0'), pagadoCentimos, devueltoCentimos, filas);
  }

  private resumenCobro(
    idPedido: string,
    totalCentimos: number,
    pagadoCentimos: number,
    devueltoCentimos: number,
    filas: Array<typeof transacciones_caja.$inferSelect>,
  ) {
    const subtotalSinIgv = Math.round(totalCentimos / IGV);
    return {
      pedido_id: idPedido,
      transacciones: filas,
      estado_pago: estadoPago(totalCentimos, pagadoCentimos, devueltoCentimos),
      total_pedido: desdeCentimos(totalCentimos),
      total_pagado: desdeCentimos(pagadoCentimos),
      saldo_pendiente: desdeCentimos(Math.max(0, totalCentimos - pagadoCentimos)),
      // Desglose del total del pedido con IGV 18% para el comprobante.
      desglose: {
        subtotal_sin_igv: desdeCentimos(subtotalSinIgv),
        igv_18: desdeCentimos(totalCentimos - subtotalSinIgv),
        total: desdeCentimos(totalCentimos),
      },
    };
  }

  // =========================================================================
  // DEVOLUCIONES
  // =========================================================================

  /**
   * Devuelve (total o parcialmente) un cobro. Sale del turno de caja ABIERTO aunque el cobro sea de un turno anterior,
   * con el mismo método de pago, motivo obligatorio y auditoría. Nunca supera lo cobrado en esa transacción, y una
   * devolución en efectivo exige efectivo suficiente en caja. Idempotency-Key obligatoria.
   */
  async registrarDevolucion(dto: DevolucionDto, usuario: UsuarioAutenticado, claveIdempotencia: string) {
    const monto = aCentimos(dto.monto);
    const claveFila = `${claveIdempotencia}#0`;

    const previa = await this.devolucionPrevia(usuario.id_usuario, claveFila, dto.id_transaccion_origen, monto);
    if (previa) return { ...previa, reutilizado: true };

    try {
      const resultado = await this.db.transaction(async (tx) => {
        const [origenPrevio] = await tx
          .select({ id_pedido: transacciones_caja.id_pedido })
          .from(transacciones_caja)
          .where(
            and(
              eq(transacciones_caja.id_transaccion_caja, dto.id_transaccion_origen),
              eq(transacciones_caja.tipo_movimiento, 'venta'),
              eq(transacciones_caja.eliminado, false),
            ),
          );
        if (!origenPrevio?.id_pedido) throw new NotFoundException('El cobro que se quiere devolver no existe.');

        // Mismo orden de bloqueo que el cobro: pedido -> turno -> cobro de origen.
        await tx.select({ id: pedidos.id_pedido }).from(pedidos).where(eq(pedidos.id_pedido, origenPrevio.id_pedido)).for('update');
        const turno = await this.turnoAbiertoBloqueado(tx);
        const [origen] = await tx
          .select()
          .from(transacciones_caja)
          .where(eq(transacciones_caja.id_transaccion_caja, dto.id_transaccion_origen))
          .for('update');

        const [{ devuelto }] = await tx
          .select({ devuelto: sql<string>`coalesce(sum(${transacciones_caja.monto}), 0)::text` })
          .from(transacciones_caja)
          .where(
            and(
              eq(transacciones_caja.id_transaccion_origen, origen.id_transaccion_caja),
              eq(transacciones_caja.tipo_movimiento, 'devolucion'),
              eq(transacciones_caja.eliminado, false),
            ),
          );
        const disponible = aCentimos(origen.monto) - aCentimos(devuelto);
        if (monto > disponible) {
          throw new BadRequestException(`Solo se pueden devolver S/ ${desdeCentimos(Math.max(0, disponible))} de ese cobro.`);
        }

        if (origen.metodo_pago === 'efectivo') {
          const movs = await tx
            .select({ tipo_movimiento: transacciones_caja.tipo_movimiento, metodo_pago: transacciones_caja.metodo_pago, monto: transacciones_caja.monto })
            .from(transacciones_caja)
            .where(and(eq(transacciones_caja.id_turno_caja, turno.id_turno_caja), eq(transacciones_caja.eliminado, false)));
          const enCaja = aCentimos(turno.monto_inicial) + this.efectivoNeto(movs);
          if (monto > enCaja) {
            throw new ConflictException(`No hay efectivo suficiente en caja para devolver S/ ${desdeCentimos(monto)} (disponible S/ ${desdeCentimos(Math.max(0, enCaja))}).`);
          }
        }

        const [fila] = await tx
          .insert(transacciones_caja)
          .values({
            id_turno_caja: turno.id_turno_caja,
            id_pedido: origen.id_pedido,
            id_transaccion_origen: origen.id_transaccion_caja,
            tipo_movimiento: 'devolucion',
            metodo_pago: origen.metodo_pago,
            monto: desdeCentimos(monto),
            notas: dto.motivo.trim(),
            clave_idempotencia: claveFila,
            usuario_creacion: usuario.id_usuario,
            usuario_edicion: usuario.id_usuario,
          })
          .returning();

        await this.audit.registrarEnTransaccion(tx, {
          id_usuario: usuario.id_usuario,
          evento: 'DEVOLUCION_REGISTRADA',
          nivel_severidad: 'WARN',
          detalles: {
            id_pedido: origen.id_pedido,
            id_transaccion_origen: origen.id_transaccion_caja,
            metodo: origen.metodo_pago,
            monto: fila.monto,
            motivo: dto.motivo.trim(),
          },
        });

        return fila;
      });

      return { ...(await this.resumenDevolucion(resultado)), reutilizado: false };
    } catch (error) {
      if (esViolacionUnica(error)) {
        const ganadora = await this.devolucionPrevia(usuario.id_usuario, claveFila, dto.id_transaccion_origen, monto);
        if (ganadora) return { ...ganadora, reutilizado: true };
      }
      throw error;
    }
  }

  private async devolucionPrevia(idUsuario: string, claveFila: string, idOrigen: string, monto: number) {
    const [fila] = await this.db
      .select()
      .from(transacciones_caja)
      .where(and(eq(transacciones_caja.usuario_creacion, idUsuario), eq(transacciones_caja.clave_idempotencia, claveFila)));
    if (!fila) return null;
    if (fila.tipo_movimiento !== 'devolucion' || fila.id_transaccion_origen !== idOrigen || aCentimos(fila.monto) !== monto) {
      throw new ConflictException('Esa Idempotency-Key ya se usó con otra operación. Genera una clave nueva.');
    }
    return this.resumenDevolucion(fila);
  }

  private async resumenDevolucion(fila: typeof transacciones_caja.$inferSelect) {
    const idPedido = fila.id_pedido as string;
    const [pedido] = await this.db.select().from(pedidos).where(eq(pedidos.id_pedido, idPedido));
    const { pagadoCentimos, devueltoCentimos } = await totalesPagos(this.db, idPedido);
    const total = aCentimos(pedido?.total_calculado ?? '0');
    return {
      devolucion: fila,
      pedido_id: idPedido,
      estado_pago: estadoPago(total, pagadoCentimos, devueltoCentimos),
      total_pagado: desdeCentimos(pagadoCentimos),
      total_devuelto: desdeCentimos(devueltoCentimos),
      neto_cobrado: desdeCentimos(pagadoCentimos - devueltoCentimos),
    };
  }

  // =========================================================================
  // HISTORIAL
  // =========================================================================

  /**
   * Libro de transacciones con quién registró cada una. El OWNER ve todo; el resto, las de los turnos que abrió y las
   * del turno abierto actual (que comparte la caja).
   */
  async listarHistorial(usuario: UsuarioAutenticado, idTurnoCaja?: string) {
    const condiciones = [eq(transacciones_caja.eliminado, false)];

    if (usuario.tipo_cuenta !== 'OWNER') {
      const visibles = await this.db
        .select({ id: turnos_caja.id_turno_caja })
        .from(turnos_caja)
        .where(
          and(
            eq(turnos_caja.eliminado, false),
            or(eq(turnos_caja.id_usuario_apertura, usuario.id_usuario), eq(turnos_caja.estado, 'abierta')),
          ),
        );
      const ids = visibles.map((t) => t.id);
      if (idTurnoCaja && !ids.includes(idTurnoCaja)) {
        throw new ForbiddenException('Solo puedes consultar los turnos de caja que abriste o el turno abierto.');
      }
      if (ids.length === 0) return [];
      condiciones.push(inArray(transacciones_caja.id_turno_caja, ids));
    }

    if (idTurnoCaja) condiciones.push(eq(transacciones_caja.id_turno_caja, idTurnoCaja));

    return this.db
      .select({
        id_transaccion_caja: transacciones_caja.id_transaccion_caja,
        id_turno_caja: transacciones_caja.id_turno_caja,
        id_pedido: transacciones_caja.id_pedido,
        tipo_movimiento: transacciones_caja.tipo_movimiento,
        metodo_pago: transacciones_caja.metodo_pago,
        monto: transacciones_caja.monto,
        notas: transacciones_caja.notas,
        es_ajuste: transacciones_caja.es_ajuste,
        fecha_creacion: transacciones_caja.fecha_creacion,
        registrado_por: usuarios.nombre,
      })
      .from(transacciones_caja)
      .leftJoin(usuarios, eq(usuarios.id_usuario, transacciones_caja.usuario_creacion))
      .where(and(...condiciones))
      .orderBy(desc(transacciones_caja.fecha_creacion))
      .limit(100);
  }
}
