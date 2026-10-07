import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, sql, asc, inArray } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { mesas } from '../../common/database/schema/tables.schema';
import { pedidos } from '../../common/database/schema/orders.schema';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { ListMesasQueryDto } from './dto/list-mesas-query.dto';
import { RealtimeBus } from '../../common/realtime/realtime-bus.service';
import { DateUtils } from '../../core/utils/date.utils';

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

/** Pedidos que mantienen "viva" una mesa: aún no se cobraron ni se anularon. */
const ESTADOS_ACTIVOS = ['pendiente', 'en_preparacion', 'listo'];

/**
 * Cambios de estado que una persona puede hacer a mano (TAB-004, TAB-006). El paso a 'por_limpiar' NO está aquí:
 * lo hace solo el cobro del pedido. Salir de 'por_limpiar' (limpieza lista) lo hace el KDS con KdsService.marcarMesaLista.
 */
const TRANSICIONES_MANUALES: Record<string, string[]> = {
  libre: ['ocupada'],
  ocupada: ['por_cobrar', 'libre'],
  por_cobrar: ['ocupada', 'libre'],
  por_limpiar: ['libre'],
};

/**
 * Mesas del local. Reglas: TAB-001 alta/renombre/baja, TAB-002 identificador único entre las activas,
 * TAB-003 área, TAB-005 no se elimina una mesa con pedidos activos, TAB-006 una mesa solo se libera cuando no
 * quedan pedidos en curso. El historial de pedidos conserva el nombre de la mesa original (snapshot en `pedidos`).
 */
@Injectable()
export class TablesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly bus: RealtimeBus,
  ) {}

  // =========================================================================
  // GESTIÓN CRUD DE MESAS
  // =========================================================================

  async crearMesa(dto: CreateTableDto, idOperador?: string) {
    const numeroNorm = dto.numero.trim().toUpperCase();
    await this.exigirNumeroLibre(this.db, numeroNorm);

    const [nuevaMesa] = await this.db
      .insert(mesas)
      .values({
        numero: numeroNorm,
        area: dto.area?.trim() || null,
        capacidad: dto.capacidad ?? 2,
        estado: 'libre', // una mesa nueva siempre nace libre; su estado lo mueve la operación
        usuario_creacion: idOperador ?? null,
        usuario_edicion: idOperador ?? null,
      })
      .returning();

    return nuevaMesa;
  }

  /**
   * Plano del salón con su estado y los pedidos en curso de cada mesa.
   */
  async listarMesas(filtros: ListMesasQueryDto = {}) {
    const condiciones = [eq(mesas.eliminado, false)];
    if (filtros.estado) condiciones.push(eq(mesas.estado, filtros.estado));
    if (filtros.area) condiciones.push(sql`lower(${mesas.area}) = lower(${filtros.area})`);

    const listaMesas = await this.db
      .select()
      .from(mesas)
      .where(and(...condiciones))
      .orderBy(asc(mesas.area), asc(mesas.numero));

    if (listaMesas.length === 0) return [];

    const pedidosActivos = await this.db
      .select({
        id_pedido: pedidos.id_pedido,
        id_mesa: pedidos.id_mesa,
        estado: pedidos.estado,
        total_calculado: pedidos.total_calculado,
        fecha_creacion: pedidos.fecha_creacion,
      })
      .from(pedidos)
      .where(
        and(
          eq(pedidos.eliminado, false),
          inArray(pedidos.estado, ESTADOS_ACTIVOS),
          inArray(
            pedidos.id_mesa,
            listaMesas.map((m) => m.id_mesa),
          ),
        ),
      )
      .orderBy(asc(pedidos.fecha_creacion));

    return listaMesas.map((m) => {
      const propios = pedidosActivos.filter((p) => p.id_mesa === m.id_mesa);
      const primero = propios[0];
      return {
        ...m,
        pedidos_activos: propios.length,
        pedido_activo: primero
          ? {
              id_pedido: primero.id_pedido,
              estado: primero.estado,
              total: primero.total_calculado,
              fecha_apertura: primero.fecha_creacion,
            }
          : null,
      };
    });
  }

  async obtenerPorId(idMesa: string, ejecutor: DrizzleDb | Tx = this.db) {
    const [mesa] = await (ejecutor as DrizzleDb)
      .select()
      .from(mesas)
      .where(and(eq(mesas.id_mesa, idMesa), eq(mesas.eliminado, false)))
      .limit(1);

    if (!mesa) {
      throw new NotFoundException('La mesa solicitada no existe o fue retirada.');
    }

    return mesa;
  }

  async actualizarMesa(idMesa: string, dto: UpdateTableDto, idOperador?: string) {
    await this.obtenerPorId(idMesa);

    const camposActualizar: Record<string, unknown> = {
      fecha_edicion: DateUtils.ahoraUtc(),
      usuario_edicion: idOperador ?? null,
    };

    if (dto.numero) {
      const numeroNorm = dto.numero.trim().toUpperCase();
      await this.exigirNumeroLibre(this.db, numeroNorm, idMesa);
      camposActualizar.numero = numeroNorm;
    }

    if (dto.capacidad !== undefined) camposActualizar.capacidad = dto.capacidad;
    if (dto.area !== undefined) camposActualizar.area = dto.area.trim() || null;

    // Renombrar una mesa no altera el historial: los pedidos ya guardan el nombre que tenía al tomarse (TAB-007).
    const [actualizada] = await this.db
      .update(mesas)
      .set(camposActualizar)
      .where(eq(mesas.id_mesa, idMesa))
      .returning();

    return actualizada;
  }

  /**
   * Cambio de estado manual (ocupada, por cobrar, libre). Solo se permiten las transiciones de
   * TRANSICIONES_MANUALES y una mesa solo pasa a 'libre' si no tiene pedidos en curso (TAB-006).
   */
  async cambiarEstadoMesa(idMesa: string, nuevoEstado: string, idOperador?: string) {
    const actualizada = await this.db.transaction(async (tx) => {
      const [mesa] = await tx
        .select()
        .from(mesas)
        .where(and(eq(mesas.id_mesa, idMesa), eq(mesas.eliminado, false)))
        .for('update');
      if (!mesa) throw new NotFoundException('La mesa solicitada no existe o fue retirada.');

      const estadoActual = mesa.estado ?? 'libre';
      if (estadoActual === nuevoEstado) return mesa;

      if (!(TRANSICIONES_MANUALES[estadoActual] ?? []).includes(nuevoEstado)) {
        throw new ConflictException(`No se puede pasar una mesa de "${estadoActual}" a "${nuevoEstado}".`);
      }

      if (nuevoEstado === 'libre' && estadoActual !== 'por_limpiar' && (await this.tienePedidosActivos(tx, idMesa))) {
        throw new ConflictException('La mesa tiene pedidos en curso: cóbralos o anúlalos antes de liberarla.');
      }

      const [fila] = await tx
        .update(mesas)
        .set({ estado: nuevoEstado, fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: idOperador ?? null })
        .where(eq(mesas.id_mesa, idMesa))
        .returning();
      return fila;
    });

    // Las pantallas del salón y el KDS se actualizan al instante (después de confirmar el cambio).
    this.bus.emitir('mesa:estado-actualizado', { id_mesa: idMesa, estado: actualizada.estado ?? nuevoEstado });
    return actualizada;
  }

  async eliminarMesa(idMesa: string, idOperador?: string) {
    await this.db.transaction(async (tx) => {
      const [mesa] = await tx
        .select()
        .from(mesas)
        .where(and(eq(mesas.id_mesa, idMesa), eq(mesas.eliminado, false)))
        .for('update');
      if (!mesa) throw new NotFoundException('La mesa solicitada no existe o fue retirada.');

      // TAB-005: se mira la existencia real de pedidos en curso, no solo la etiqueta de estado de la mesa.
      if (mesa.estado !== 'libre' || (await this.tienePedidosActivos(tx, idMesa))) {
        throw new BadRequestException(
          'No se puede retirar una mesa que tiene comensales, una cuenta pendiente o pedidos en curso.',
        );
      }

      await tx
        .update(mesas)
        .set({ eliminado: true, fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: idOperador ?? null })
        .where(eq(mesas.id_mesa, idMesa));
    });
  }

  // =========================================================================
  // APOYO
  // =========================================================================

  private async tienePedidosActivos(ejecutor: DrizzleDb | Tx, idMesa: string): Promise<boolean> {
    const [pedido] = await (ejecutor as DrizzleDb)
      .select({ id: pedidos.id_pedido })
      .from(pedidos)
      .where(and(eq(pedidos.id_mesa, idMesa), eq(pedidos.eliminado, false), inArray(pedidos.estado, ESTADOS_ACTIVOS)))
      .limit(1);
    return Boolean(pedido);
  }

  private async exigirNumeroLibre(ejecutor: DrizzleDb | Tx, numero: string, excluirId?: string): Promise<void> {
    const [duplicado] = await (ejecutor as DrizzleDb)
      .select({ id: mesas.id_mesa })
      .from(mesas)
      .where(
        and(
          eq(mesas.numero, numero),
          eq(mesas.eliminado, false),
          excluirId ? sql`${mesas.id_mesa} != ${excluirId}` : undefined,
        ),
      )
      .limit(1);

    if (duplicado) {
      throw new ConflictException(`Ya existe una mesa activa con el identificador "${numero}".`);
    }
  }
}
