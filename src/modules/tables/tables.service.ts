import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, sql, desc, asc, notInArray } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { mesas } from '../../common/database/schema/tables.schema';
import { pedidos } from '../../common/database/schema/orders.schema';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { DateUtils } from '../../core/utils/date.utils';

@Injectable()
export class TablesService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // =========================================================================
  // GESTIÓN CRUD DE MESAS
  // =========================================================================

  async crearMesa(dto: CreateTableDto, idOperador?: string) {
    const numeroNorm = dto.numero.trim().toUpperCase();

    // Validar identificador único
    const [existente] = await this.db
      .select({ id: mesas.id_mesa })
      .from(mesas)
      .where(and(eq(mesas.numero, numeroNorm), eq(mesas.eliminado, false)))
      .limit(1);

    if (existente) {
      throw new ConflictException(`Ya existe una mesa activa con el identificador "${numeroNorm}".`);
    }

    const [nuevaMesa] = await this.db
      .insert(mesas)
      .values({
        numero: numeroNorm,
        capacidad: dto.capacidad ?? 2,
        estado: dto.estado ?? 'libre',
        usuario_creacion: idOperador ?? null,
        usuario_edicion: idOperador ?? null,
      })
      .returning();

    return nuevaMesa;
  }

  /**
   * Listado del plano de salón con su estado y el pedido activo (si está ocupada)
   */
  async listarMesas(filtroEstado?: string) {
    const condiciones = [eq(mesas.eliminado, false)];

    if (filtroEstado) {
      condiciones.push(eq(mesas.estado, filtroEstado));
    }

    // 1. Obtener todas las mesas ordenadas
    const listaMesas = await this.db
      .select()
      .from(mesas)
      .where(and(...condiciones))
      .orderBy(asc(mesas.numero));

    // 2. Obtener pedidos activos de salón (no pagados ni anulados)
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
          notInArray(pedidos.estado, ['pagado', 'anulado']),
        ),
      );

    // Mapear cada mesa con su comanda abierta si existe
    return listaMesas.map((m) => {
      const pedidoActivo = pedidosActivos.find((p) => p.id_mesa === m.id_mesa);
      return {
        ...m,
        pedido_activo: pedidoActivo
          ? {
              id_pedido: pedidoActivo.id_pedido,
              estado: pedidoActivo.estado,
              total: pedidoActivo.total_calculado,
              fecha_apertura: pedidoActivo.fecha_creacion,
            }
          : null,
      };
    });
  }

  async obtenerPorId(idMesa: string) {
    const [mesa] = await this.db
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
      const [duplicado] = await this.db
        .select({ id: mesas.id_mesa })
        .from(mesas)
        .where(
          and(
            eq(mesas.numero, numeroNorm),
            sql`${mesas.id_mesa} != ${idMesa}`,
            eq(mesas.eliminado, false),
          ),
        )
        .limit(1);

      if (duplicado) {
        throw new ConflictException(`Ya existe otra mesa con el identificador "${numeroNorm}".`);
      }
      camposActualizar.numero = numeroNorm;
    }

    if (dto.capacidad !== undefined) camposActualizar.capacidad = dto.capacidad;
    if (dto.estado) camposActualizar.estado = dto.estado;

    const [actualizada] = await this.db
      .update(mesas)
      .set(camposActualizar)
      .where(eq(mesas.id_mesa, idMesa))
      .returning();

    return actualizada;
  }

  /**
   * Cambia el estado de la mesa (libre, ocupada, por_cobrar)
   */
  async cambiarEstadoMesa(idMesa: string, nuevoEstado: string, idOperador?: string) {
    await this.obtenerPorId(idMesa);

    const [actualizada] = await this.db
      .update(mesas)
      .set({
        estado: nuevoEstado,
        fecha_edicion: DateUtils.ahoraUtc(),
        usuario_edicion: idOperador ?? null,
      })
      .where(eq(mesas.id_mesa, idMesa))
      .returning();

    return actualizada;
  }

  /**
   * Libera una mesa (llamado manualmente o al confirmar pago en Transactions)
   */
  async liberarMesa(idMesa: string, idOperador?: string) {
    return this.cambiarEstadoMesa(idMesa, 'libre', idOperador);
  }

  /**
   * Ocupa una mesa (llamado al aperturar una comanda en Orders)
   */
  async ocuparMesa(idMesa: string, idOperador?: string) {
    return this.cambiarEstadoMesa(idMesa, 'ocupada', idOperador);
  }

  async eliminarMesa(idMesa: string, idOperador?: string) {
    const mesa = await this.obtenerPorId(idMesa);

    if (mesa.estado === 'ocupada' || mesa.estado === 'por_cobrar') {
      throw new BadRequestException(
        'No se puede eliminar una mesa que actualmente tiene comensales o una cuenta pendiente.',
      );
    }

    await this.db
      .update(mesas)
      .set({
        eliminado: true,
        fecha_edicion: DateUtils.ahoraUtc(),
        usuario_edicion: idOperador ?? null,
      })
      .where(eq(mesas.id_mesa, idMesa));
  }
}