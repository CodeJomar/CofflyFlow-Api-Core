import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import {
  grupos_modificadores,
  opciones_modificador,
  productos,
  productos_grupos_modificadores,
} from '../../common/database/schema/menu.schema';
import { DateUtils } from '../../core/utils/date.utils';
import { aCentimos, desdeCentimos } from '../../common/validators/money.validator';
import {
  AsignarGruposDto,
  CreateGrupoDto,
  CreateOpcionDto,
  UpdateGrupoDto,
  UpdateOpcionDto,
} from './dto/modifiers.dto';

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
type Ejecutor = DrizzleDb | Tx;

export interface OpcionDto {
  id_opcion: string;
  nombre: string;
  price_delta: string;
  disponible: boolean;
  orden_visual: number;
}

export interface GrupoDto {
  id_grupo: string;
  nombre: string;
  descripcion: string | null;
  seleccion_minima: number;
  seleccion_maxima: number;
  /** Un grupo con selección mínima >= 1 es obligatorio (MENU-006). */
  obligatorio: boolean;
  orden_visual: number;
  opciones: OpcionDto[];
}

/** Lo que se guarda en el pedido para cada modificador elegido: nombres y variación al momento de la venta (MENU-009). */
export interface ModificadorSnapshot {
  id_grupo: string;
  grupo: string;
  id_opcion: string;
  opcion: string;
  price_delta: string;
}

export interface LineaParaModificadores {
  id_producto: string;
  nombre_producto: string;
  ids_opcion: string[];
}

export interface SeleccionResuelta {
  snapshot: ModificadorSnapshot[];
  deltaCentimos: number;
}

/**
 * Modificadores del menú: grupos, opciones y su asignación a productos (MENU-003..007), más la validación de la
 * selección que llega en un pedido. El cliente solo envía ids de opciones; nombres, variaciones de precio,
 * disponibilidad y límites (mínimo/máximo, obligatorios) se resuelven SIEMPRE en el servidor.
 */
@Injectable()
export class ModifiersService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // =========================================================================
  // LECTURA
  // =========================================================================

  async listarGrupos(): Promise<GrupoDto[]> {
    const grupos = await this.db
      .select()
      .from(grupos_modificadores)
      .where(eq(grupos_modificadores.eliminado, false))
      .orderBy(asc(grupos_modificadores.orden_visual), asc(grupos_modificadores.nombre));
    return this.armarGrupos(this.db, grupos);
  }

  async obtenerGrupo(idGrupo: string, ejecutor: Ejecutor = this.db): Promise<GrupoDto> {
    const [grupo] = await (ejecutor as DrizzleDb)
      .select()
      .from(grupos_modificadores)
      .where(and(eq(grupos_modificadores.id_grupo, idGrupo), eq(grupos_modificadores.eliminado, false)))
      .limit(1);
    if (!grupo) throw new NotFoundException('El grupo de modificadores no existe o fue eliminado.');
    return (await this.armarGrupos(ejecutor, [grupo]))[0];
  }

  /** Grupos (con sus opciones activas) asignados a cada producto, en el orden de la asignación. */
  async gruposPorProductos(idsProducto: string[], ejecutor: Ejecutor = this.db): Promise<Map<string, GrupoDto[]>> {
    const resultado = new Map<string, GrupoDto[]>();
    if (idsProducto.length === 0) return resultado;
    const exec = ejecutor as DrizzleDb;

    const asignaciones = await exec
      .select({
        id_producto: productos_grupos_modificadores.id_producto,
        orden_asignacion: productos_grupos_modificadores.orden_visual,
        grupo: grupos_modificadores,
      })
      .from(productos_grupos_modificadores)
      .innerJoin(grupos_modificadores, eq(productos_grupos_modificadores.id_grupo, grupos_modificadores.id_grupo))
      .where(
        and(
          inArray(productos_grupos_modificadores.id_producto, idsProducto),
          eq(productos_grupos_modificadores.eliminado, false),
          eq(grupos_modificadores.eliminado, false),
        ),
      )
      .orderBy(asc(productos_grupos_modificadores.orden_visual), asc(grupos_modificadores.nombre));

    const gruposUnicos = [...new Map(asignaciones.map((a) => [a.grupo.id_grupo, a.grupo])).values()];
    const armados = new Map((await this.armarGrupos(exec, gruposUnicos)).map((g) => [g.id_grupo, g]));

    for (const a of asignaciones) {
      const lista = resultado.get(a.id_producto) ?? [];
      lista.push(armados.get(a.grupo.id_grupo)!);
      resultado.set(a.id_producto, lista);
    }
    return resultado;
  }

  private async armarGrupos(ejecutor: Ejecutor, grupos: Array<typeof grupos_modificadores.$inferSelect>): Promise<GrupoDto[]> {
    if (grupos.length === 0) return [];
    const opciones = await (ejecutor as DrizzleDb)
      .select()
      .from(opciones_modificador)
      .where(
        and(
          inArray(
            opciones_modificador.id_grupo,
            grupos.map((g) => g.id_grupo),
          ),
          eq(opciones_modificador.eliminado, false),
        ),
      )
      .orderBy(asc(opciones_modificador.orden_visual), asc(opciones_modificador.nombre));

    return grupos.map((g) => ({
      id_grupo: g.id_grupo,
      nombre: g.nombre,
      descripcion: g.descripcion,
      seleccion_minima: g.seleccion_minima,
      seleccion_maxima: g.seleccion_maxima,
      obligatorio: g.seleccion_minima >= 1,
      orden_visual: g.orden_visual ?? 0,
      opciones: opciones
        .filter((o) => o.id_grupo === g.id_grupo)
        .map((o) => ({
          id_opcion: o.id_opcion,
          nombre: o.nombre,
          price_delta: o.price_delta,
          disponible: o.disponible ?? true,
          orden_visual: o.orden_visual ?? 0,
        })),
    }));
  }

  // =========================================================================
  // GRUPOS
  // =========================================================================

  private validarLimites(minima: number, maxima: number): void {
    if (maxima < minima) {
      throw new BadRequestException('La selección máxima no puede ser menor que la mínima.');
    }
  }

  async crearGrupo(dto: CreateGrupoDto, idOperador: string): Promise<GrupoDto> {
    const minima = dto.seleccion_minima ?? 0;
    const maxima = dto.seleccion_maxima ?? Math.max(1, minima);
    this.validarLimites(minima, maxima);

    const opciones = dto.opciones ?? [];
    this.validarNombresUnicos(opciones.map((o) => o.nombre));
    if (opciones.length > 0 && opciones.filter((o) => o.disponible !== false).length < minima) {
      throw new BadRequestException('El grupo exige más selecciones mínimas que opciones disponibles.');
    }

    return this.db.transaction(async (tx) => {
      await this.exigirNombreGrupoLibre(tx, dto.nombre.trim());
      const [grupo] = await tx
        .insert(grupos_modificadores)
        .values({
          nombre: dto.nombre.trim(),
          descripcion: dto.descripcion?.trim() ?? null,
          seleccion_minima: minima,
          seleccion_maxima: maxima,
          orden_visual: dto.orden_visual ?? 0,
          usuario_creacion: idOperador,
          usuario_edicion: idOperador,
        })
        .returning();

      if (opciones.length > 0) {
        await tx.insert(opciones_modificador).values(
          opciones.map((o, i) => ({
            id_grupo: grupo.id_grupo,
            nombre: o.nombre.trim(),
            price_delta: o.price_delta ?? '0.00',
            disponible: o.disponible ?? true,
            orden_visual: o.orden_visual ?? i,
            usuario_creacion: idOperador,
            usuario_edicion: idOperador,
          })),
        );
      }
      return this.obtenerGrupo(grupo.id_grupo, tx);
    });
  }

  async actualizarGrupo(idGrupo: string, dto: UpdateGrupoDto, idOperador: string): Promise<GrupoDto> {
    return this.db.transaction(async (tx) => {
      const actual = await this.obtenerGrupo(idGrupo, tx);
      const minima = dto.seleccion_minima ?? actual.seleccion_minima;
      const maxima = dto.seleccion_maxima ?? actual.seleccion_maxima;
      this.validarLimites(minima, maxima);
      if (minima > actual.opciones.filter((o) => o.disponible).length && actual.opciones.length > 0) {
        throw new BadRequestException('La selección mínima no puede superar la cantidad de opciones disponibles del grupo.');
      }

      const campos: Record<string, unknown> = { fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: idOperador };
      if (dto.nombre !== undefined) {
        await this.exigirNombreGrupoLibre(tx, dto.nombre.trim(), idGrupo);
        campos.nombre = dto.nombre.trim();
      }
      if (dto.descripcion !== undefined) campos.descripcion = dto.descripcion.trim();
      if (dto.orden_visual !== undefined) campos.orden_visual = dto.orden_visual;
      campos.seleccion_minima = minima;
      campos.seleccion_maxima = maxima;

      await tx.update(grupos_modificadores).set(campos).where(eq(grupos_modificadores.id_grupo, idGrupo));
      return this.obtenerGrupo(idGrupo, tx);
    });
  }

  /** Baja lógica del grupo: también sus opciones y su asignación a productos. Los pedidos pasados conservan su snapshot. */
  async eliminarGrupo(idGrupo: string, idOperador: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.obtenerGrupo(idGrupo, tx);
      const baja = { eliminado: true, fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: idOperador };
      await tx.update(productos_grupos_modificadores).set(baja).where(eq(productos_grupos_modificadores.id_grupo, idGrupo));
      await tx.update(opciones_modificador).set(baja).where(eq(opciones_modificador.id_grupo, idGrupo));
      await tx.update(grupos_modificadores).set(baja).where(eq(grupos_modificadores.id_grupo, idGrupo));
    });
  }

  private async exigirNombreGrupoLibre(tx: Ejecutor, nombre: string, excluirId?: string): Promise<void> {
    const [duplicado] = await (tx as DrizzleDb)
      .select({ id: grupos_modificadores.id_grupo })
      .from(grupos_modificadores)
      .where(
        and(
          sql`lower(${grupos_modificadores.nombre}) = lower(${nombre})`,
          eq(grupos_modificadores.eliminado, false),
          excluirId ? sql`${grupos_modificadores.id_grupo} != ${excluirId}` : undefined,
        ),
      )
      .limit(1);
    if (duplicado) throw new ConflictException('Ya existe un grupo de modificadores con ese nombre.');
  }

  private validarNombresUnicos(nombres: string[]): void {
    const vistos = new Set<string>();
    for (const n of nombres) {
      const clave = n.trim().toLowerCase();
      if (vistos.has(clave)) throw new BadRequestException(`La opción "${n}" está repetida en el grupo.`);
      vistos.add(clave);
    }
  }

  // =========================================================================
  // OPCIONES
  // =========================================================================

  async crearOpcion(idGrupo: string, dto: CreateOpcionDto, idOperador: string): Promise<GrupoDto> {
    return this.db.transaction(async (tx) => {
      await this.obtenerGrupo(idGrupo, tx);
      await this.exigirNombreOpcionLibre(tx, idGrupo, dto.nombre.trim());
      await tx.insert(opciones_modificador).values({
        id_grupo: idGrupo,
        nombre: dto.nombre.trim(),
        price_delta: dto.price_delta ?? '0.00',
        disponible: dto.disponible ?? true,
        orden_visual: dto.orden_visual ?? 0,
        usuario_creacion: idOperador,
        usuario_edicion: idOperador,
      });
      return this.obtenerGrupo(idGrupo, tx);
    });
  }

  private async obtenerOpcionActiva(tx: Ejecutor, idOpcion: string) {
    const [opcion] = await (tx as DrizzleDb)
      .select()
      .from(opciones_modificador)
      .where(and(eq(opciones_modificador.id_opcion, idOpcion), eq(opciones_modificador.eliminado, false)))
      .limit(1);
    if (!opcion) throw new NotFoundException('La opción no existe o fue eliminada.');
    return opcion;
  }

  async actualizarOpcion(idOpcion: string, dto: UpdateOpcionDto, idOperador: string): Promise<GrupoDto> {
    return this.db.transaction(async (tx) => {
      const opcion = await this.obtenerOpcionActiva(tx, idOpcion);
      const campos: Record<string, unknown> = { fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: idOperador };
      if (dto.nombre !== undefined) {
        await this.exigirNombreOpcionLibre(tx, opcion.id_grupo, dto.nombre.trim(), idOpcion);
        campos.nombre = dto.nombre.trim();
      }
      if (dto.price_delta !== undefined) campos.price_delta = dto.price_delta;
      if (dto.disponible !== undefined) campos.disponible = dto.disponible;
      if (dto.orden_visual !== undefined) campos.orden_visual = dto.orden_visual;
      await tx.update(opciones_modificador).set(campos).where(eq(opciones_modificador.id_opcion, idOpcion));
      return this.obtenerGrupo(opcion.id_grupo, tx);
    });
  }

  /** Marca la opción como disponible o agotada con un toque (MENU-007), sin eliminarla. */
  async conmutarDisponibilidadOpcion(idOpcion: string, disponible: boolean | undefined, idOperador: string): Promise<GrupoDto> {
    return this.db.transaction(async (tx) => {
      const opcion = await this.obtenerOpcionActiva(tx, idOpcion);
      await tx
        .update(opciones_modificador)
        .set({
          disponible: disponible ?? !opcion.disponible,
          fecha_edicion: DateUtils.ahoraUtc(),
          usuario_edicion: idOperador,
        })
        .where(eq(opciones_modificador.id_opcion, idOpcion));
      return this.obtenerGrupo(opcion.id_grupo, tx);
    });
  }

  async eliminarOpcion(idOpcion: string, idOperador: string): Promise<GrupoDto> {
    return this.db.transaction(async (tx) => {
      const opcion = await this.obtenerOpcionActiva(tx, idOpcion);
      await tx
        .update(opciones_modificador)
        .set({ eliminado: true, fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: idOperador })
        .where(eq(opciones_modificador.id_opcion, idOpcion));
      return this.obtenerGrupo(opcion.id_grupo, tx);
    });
  }

  private async exigirNombreOpcionLibre(tx: Ejecutor, idGrupo: string, nombre: string, excluirId?: string): Promise<void> {
    const [duplicada] = await (tx as DrizzleDb)
      .select({ id: opciones_modificador.id_opcion })
      .from(opciones_modificador)
      .where(
        and(
          eq(opciones_modificador.id_grupo, idGrupo),
          sql`lower(${opciones_modificador.nombre}) = lower(${nombre})`,
          eq(opciones_modificador.eliminado, false),
          excluirId ? sql`${opciones_modificador.id_opcion} != ${excluirId}` : undefined,
        ),
      )
      .limit(1);
    if (duplicada) throw new ConflictException('Ya existe una opción con ese nombre en el grupo.');
  }

  // =========================================================================
  // ASIGNACIÓN A PRODUCTOS (MENU-003)
  // =========================================================================

  /** Reemplaza el conjunto completo de grupos de un producto. */
  async asignarGruposAProducto(idProducto: string, dto: AsignarGruposDto, idOperador: string): Promise<GrupoDto[]> {
    const ids = dto.grupos.map((g) => g.id_grupo);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Hay grupos repetidos en la asignación.');

    return this.db.transaction(async (tx) => {
      const [producto] = await tx
        .select({ id: productos.id_producto })
        .from(productos)
        .where(and(eq(productos.id_producto, idProducto), eq(productos.eliminado, false)))
        .for('update');
      if (!producto) throw new NotFoundException('El producto solicitado no existe o fue dado de baja.');

      if (ids.length > 0) {
        const existentes = await tx
          .select({ id: grupos_modificadores.id_grupo })
          .from(grupos_modificadores)
          .where(and(inArray(grupos_modificadores.id_grupo, ids), eq(grupos_modificadores.eliminado, false)));
        if (existentes.length !== ids.length) {
          throw new BadRequestException('Uno o más grupos de modificadores no existen o fueron eliminados.');
        }
      }

      const baja = { eliminado: true, fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: idOperador };
      await tx
        .update(productos_grupos_modificadores)
        .set(baja)
        .where(and(eq(productos_grupos_modificadores.id_producto, idProducto), eq(productos_grupos_modificadores.eliminado, false)));

      if (dto.grupos.length > 0) {
        await tx.insert(productos_grupos_modificadores).values(
          dto.grupos.map((g, i) => ({
            id_producto: idProducto,
            id_grupo: g.id_grupo,
            orden_visual: g.orden_visual ?? i,
            usuario_creacion: idOperador,
            usuario_edicion: idOperador,
          })),
        );
      }
      return (await this.gruposPorProductos([idProducto], tx)).get(idProducto) ?? [];
    });
  }

  // =========================================================================
  // VALIDACIÓN DE LA SELECCIÓN DE UN PEDIDO (MENU-004..008)
  // =========================================================================

  /**
   * Resuelve y valida los modificadores elegidos en cada línea de un pedido. Devuelve, por línea, el snapshot
   * a guardar y la variación de precio en céntimos. Debe llamarse dentro de la transacción del pedido.
   */
  async resolverSeleccion(ejecutor: Ejecutor, lineas: LineaParaModificadores[]): Promise<SeleccionResuelta[]> {
    const porProducto = await this.gruposPorProductos([...new Set(lineas.map((l) => l.id_producto))], ejecutor);

    return lineas.map((linea) => {
      const grupos = porProducto.get(linea.id_producto) ?? [];
      const ids = linea.ids_opcion;
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException(`Hay opciones repetidas en "${linea.nombre_producto}".`);
      }

      const catalogo = new Map<string, { grupo: GrupoDto; opcion: OpcionDto }>();
      for (const grupo of grupos) for (const opcion of grupo.opciones) catalogo.set(opcion.id_opcion, { grupo, opcion });

      const elegidasPorGrupo = new Map<string, Array<{ grupo: GrupoDto; opcion: OpcionDto }>>();
      for (const id of ids) {
        const hallada = catalogo.get(id);
        if (!hallada) {
          throw new BadRequestException(`Una de las opciones elegidas no corresponde a "${linea.nombre_producto}".`);
        }
        if (!hallada.opcion.disponible) {
          throw new BadRequestException(`La opción "${hallada.opcion.nombre}" está agotada.`);
        }
        const lista = elegidasPorGrupo.get(hallada.grupo.id_grupo) ?? [];
        lista.push(hallada);
        elegidasPorGrupo.set(hallada.grupo.id_grupo, lista);
      }

      const snapshot: ModificadorSnapshot[] = [];
      let deltaCentimos = 0;

      for (const grupo of grupos) {
        const elegidas = elegidasPorGrupo.get(grupo.id_grupo) ?? [];
        if (elegidas.length < grupo.seleccion_minima) {
          throw new BadRequestException(
            `"${grupo.nombre}" es obligatorio en "${linea.nombre_producto}": elige al menos ${grupo.seleccion_minima}.`,
          );
        }
        if (elegidas.length > grupo.seleccion_maxima) {
          throw new BadRequestException(
            `"${grupo.nombre}" admite como máximo ${grupo.seleccion_maxima} selección(es) en "${linea.nombre_producto}".`,
          );
        }
        for (const { opcion } of elegidas) {
          deltaCentimos += aCentimos(opcion.price_delta);
          snapshot.push({
            id_grupo: grupo.id_grupo,
            grupo: grupo.nombre,
            id_opcion: opcion.id_opcion,
            opcion: opcion.nombre,
            price_delta: desdeCentimos(aCentimos(opcion.price_delta)),
          });
        }
      }
      return { snapshot, deltaCentimos };
    });
  }
}
