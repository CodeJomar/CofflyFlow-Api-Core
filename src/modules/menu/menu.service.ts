import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, sql, asc, ilike, inArray } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { categorias, productos } from '../../common/database/schema/menu.schema';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { ListProductosQueryDto } from './dto/list-productos-query.dto';
import { ModifiersService } from './modifiers.service';
import { DateUtils } from '../../core/utils/date.utils';

@Injectable()
export class MenuService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly modifiers: ModifiersService,
  ) {}

  // =========================================================================
  // GESTIÓN DE CATEGORÍAS
  // =========================================================================

  async crearCategoria(dto: CreateCategoriaDto, idOperador?: string) {
    const nombreNormalizado = dto.nombre.trim();

    // Validar nombre único entre categorías activas
    const [existente] = await this.db
      .select({ id: categorias.id_categoria })
      .from(categorias)
      .where(and(sql`lower(${categorias.nombre}) = lower(${nombreNormalizado})`, eq(categorias.eliminado, false)))
      .limit(1);

    if (existente) {
      throw new ConflictException('Ya existe una categoría activa con este nombre.');
    }

    const [nueva] = await this.db
      .insert(categorias)
      .values({
        nombre: nombreNormalizado,
        descripcion: dto.descripcion?.trim() ?? null,
        orden_visual: dto.orden_visual ?? 0,
        usuario_creacion: idOperador ?? null,
        usuario_edicion: idOperador ?? null,
      })
      .returning();

    return nueva;
  }

  async listarCategorias() {
    return this.db
      .select()
      .from(categorias)
      .where(eq(categorias.eliminado, false))
      .orderBy(asc(categorias.orden_visual), asc(categorias.nombre));
  }

  async obtenerCategoriaPorId(idCategoria: string) {
    const [categoria] = await this.db
      .select()
      .from(categorias)
      .where(and(eq(categorias.id_categoria, idCategoria), eq(categorias.eliminado, false)))
      .limit(1);

    if (!categoria) {
      throw new NotFoundException('La categoría no existe o ha sido eliminada.');
    }

    return categoria;
  }

  /** Guarda el orden en que se muestran las categorías (el primer id queda primero). */
  async reordenarCategorias(ids: string[], idOperador?: string) {
    await this.db.transaction(async (tx) => {
      const existentes = await tx
        .select({ id: categorias.id_categoria })
        .from(categorias)
        .where(and(inArray(categorias.id_categoria, ids), eq(categorias.eliminado, false)));
      if (existentes.length !== ids.length) {
        throw new BadRequestException('Alguna de las categorías indicadas no existe o fue eliminada.');
      }
      for (const [posicion, id] of ids.entries()) {
        await tx
          .update(categorias)
          .set({ orden_visual: posicion, fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: idOperador ?? null })
          .where(eq(categorias.id_categoria, id));
      }
    });
  }

  async actualizarCategoria(idCategoria: string, dto: UpdateCategoriaDto, idOperador?: string) {
    await this.obtenerCategoriaPorId(idCategoria);

    const camposActualizar: Record<string, unknown> = {
      fecha_edicion: DateUtils.ahoraUtc(),
      usuario_edicion: idOperador ?? null,
    };

    if (dto.nombre) {
      const nombreNorm = dto.nombre.trim();
      const [duplicado] = await this.db
        .select({ id: categorias.id_categoria })
        .from(categorias)
        .where(
          and(
            sql`lower(${categorias.nombre}) = lower(${nombreNorm})`,
            sql`${categorias.id_categoria} != ${idCategoria}`,
            eq(categorias.eliminado, false),
          ),
        )
        .limit(1);

      if (duplicado) {
        throw new ConflictException('Ya existe otra categoría con ese nombre.');
      }
      camposActualizar.nombre = nombreNorm;
    }

    if (dto.descripcion !== undefined) camposActualizar.descripcion = dto.descripcion?.trim() ?? null;
    if (dto.orden_visual !== undefined) camposActualizar.orden_visual = dto.orden_visual;

    const [actualizada] = await this.db
      .update(categorias)
      .set(camposActualizar)
      .where(eq(categorias.id_categoria, idCategoria))
      .returning();

    return actualizada;
  }

  async eliminarCategoria(idCategoria: string, idOperador?: string) {
    await this.obtenerCategoriaPorId(idCategoria);

    // Validar si tiene productos activos vinculados
    const [productoActivo] = await this.db
      .select({ id: productos.id_producto })
      .from(productos)
      .where(and(eq(productos.id_categoria, idCategoria), eq(productos.eliminado, false)))
      .limit(1);

    if (productoActivo) {
      throw new BadRequestException(
        'No se puede eliminar la categoría porque contiene productos activos. Muévelos o elimínalos primero.',
      );
    }

    await this.db
      .update(categorias)
      .set({
        eliminado: true,
        fecha_edicion: DateUtils.ahoraUtc(),
        usuario_edicion: idOperador ?? null,
      })
      .where(eq(categorias.id_categoria, idCategoria));
  }

  // =========================================================================
  // GESTIÓN DE PRODUCTOS
  // =========================================================================

  async crearProducto(dto: CreateProductoDto, idOperador?: string) {
    // 1. Validar que la categoría exista y esté activa
    await this.obtenerCategoriaPorId(dto.id_categoria);

    // 2. Validar nombre único en la misma categoría
    const nombreNorm = dto.nombre.trim();
    const [duplicado] = await this.db
      .select({ id: productos.id_producto })
      .from(productos)
      .where(
        and(
          eq(productos.id_categoria, dto.id_categoria),
          sql`lower(${productos.nombre}) = lower(${nombreNorm})`,
          eq(productos.eliminado, false),
        ),
      )
      .limit(1);

    if (duplicado) {
      throw new ConflictException('Ya existe un producto con ese nombre en esta categoría.');
    }

    const [nuevoProducto] = await this.db
      .insert(productos)
      .values({
        id_categoria: dto.id_categoria,
        nombre: nombreNorm,
        descripcion: dto.descripcion?.trim() ?? null,
        precio: dto.precio,
        disponible: dto.disponible ?? true,
        imagen_url: dto.imagen_url?.trim() || null,
        usuario_creacion: idOperador ?? null,
        usuario_edicion: idOperador ?? null,
      })
      .returning();

    return nuevoProducto;
  }

  async listarProductos(query: ListProductosQueryDto) {
    const pagina = Math.max(1, Number(query.pagina) || 1);
    const limite = Math.min(100, Math.max(1, Number(query.limite) || 10));
    const offset = (pagina - 1) * limite;

    const condiciones = [eq(productos.eliminado, false)];

    if (query.id_categoria) {
      condiciones.push(eq(productos.id_categoria, query.id_categoria));
    }

    if (query.solo_disponibles !== undefined) {
      condiciones.push(eq(productos.disponible, query.solo_disponibles));
    }

    if (query.busqueda) {
      // Los comodines del usuario (% _ \) se escapan: se busca texto literal, no patrones.
      const literal = query.busqueda.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
      condiciones.push(ilike(productos.nombre, `%${literal}%`));
    }

    const whereClause = and(...condiciones);

    const [conteo] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(productos)
      .where(whereClause);

    const items = await this.db
      .select({
        id_producto: productos.id_producto,
        id_categoria: productos.id_categoria,
        categoria_nombre: categorias.nombre,
        nombre: productos.nombre,
        descripcion: productos.descripcion,
        precio: productos.precio,
        disponible: productos.disponible,
        imagen_url: productos.imagen_url,
        fecha_creacion: productos.fecha_creacion,
        fecha_edicion: productos.fecha_edicion,
      })
      .from(productos)
      .innerJoin(categorias, eq(productos.id_categoria, categorias.id_categoria))
      .where(whereClause)
      .orderBy(asc(categorias.orden_visual), asc(productos.nombre))
      .limit(limite)
      .offset(offset);

    return {
      items,
      total: Number(conteo?.total || 0),
    };
  }

  /** Detalle de producto con sus grupos de modificadores y opciones. */
  async obtenerProductoPorId(idProducto: string) {
    const producto = await this.buscarProducto(idProducto);
    const grupos = (await this.modifiers.gruposPorProductos([idProducto])).get(idProducto) ?? [];
    return { ...producto, grupos_modificadores: grupos };
  }

  private async buscarProducto(idProducto: string) {
    const [producto] = await this.db
      .select({
        id_producto: productos.id_producto,
        id_categoria: productos.id_categoria,
        categoria_nombre: categorias.nombre,
        nombre: productos.nombre,
        descripcion: productos.descripcion,
        precio: productos.precio,
        disponible: productos.disponible,
        fecha_creacion: productos.fecha_creacion,
        fecha_edicion: productos.fecha_edicion,
      })
      .from(productos)
      .innerJoin(categorias, eq(productos.id_categoria, categorias.id_categoria))
      .where(and(eq(productos.id_producto, idProducto), eq(productos.eliminado, false)))
      .limit(1);

    if (!producto) {
      throw new NotFoundException('El producto solicitado no existe o fue dado de baja.');
    }

    return producto;
  }

  async actualizarProducto(idProducto: string, dto: UpdateProductoDto, idOperador?: string) {
    const actual = await this.buscarProducto(idProducto);

    if (dto.id_categoria) {
      await this.obtenerCategoriaPorId(dto.id_categoria);
    }

    if (dto.nombre || dto.id_categoria) {
      const nombreFinal = (dto.nombre ?? actual.nombre).trim();
      const categoriaFinal = dto.id_categoria ?? actual.id_categoria;
      const [duplicado] = await this.db
        .select({ id: productos.id_producto })
        .from(productos)
        .where(
          and(
            eq(productos.id_categoria, categoriaFinal),
            sql`lower(${productos.nombre}) = lower(${nombreFinal})`,
            sql`${productos.id_producto} != ${idProducto}`,
            eq(productos.eliminado, false),
          ),
        )
        .limit(1);
      if (duplicado) {
        throw new ConflictException('Ya existe un producto con ese nombre en esta categoría.');
      }
    }

    const camposActualizar: Record<string, unknown> = {
      fecha_edicion: DateUtils.ahoraUtc(),
      usuario_edicion: idOperador ?? null,
    };

    if (dto.id_categoria) camposActualizar.id_categoria = dto.id_categoria;
    if (dto.nombre) camposActualizar.nombre = dto.nombre.trim();
    if (dto.descripcion !== undefined) camposActualizar.descripcion = dto.descripcion?.trim() ?? null;
    if (dto.precio !== undefined) camposActualizar.precio = dto.precio;
    if (dto.disponible !== undefined) camposActualizar.disponible = dto.disponible;
    if (dto.imagen_url !== undefined) camposActualizar.imagen_url = dto.imagen_url.trim() || null;

    const [actualizado] = await this.db
      .update(productos)
      .set(camposActualizar)
      .where(eq(productos.id_producto, idProducto))
      .returning();

    return actualizado;
  }

  /**
   * TOGGLE TÁCTIL RÁPIDO PARA POS / BARRA
   * Cambia el estado de disponibilidad con 1 tap o según valor explícito
   */
  async conmutarDisponibilidad(idProducto: string, disponible?: boolean, idOperador?: string) {
    const actual = await this.buscarProducto(idProducto);

    // Si no se envía parámetro, conmuta el valor actual (!actual.disponible)
    const nuevoEstado = disponible !== undefined ? disponible : !actual.disponible;

    const [actualizado] = await this.db
      .update(productos)
      .set({
        disponible: nuevoEstado,
        fecha_edicion: DateUtils.ahoraUtc(),
        usuario_edicion: idOperador ?? null,
      })
      .where(eq(productos.id_producto, idProducto))
      .returning();

    return actualizado;
  }

  async eliminarProducto(idProducto: string, idOperador?: string) {
    await this.buscarProducto(idProducto);

    await this.db
      .update(productos)
      .set({
        eliminado: true,
        disponible: false, // Se apaga también del POS
        fecha_edicion: DateUtils.ahoraUtc(),
        usuario_edicion: idOperador ?? null,
      })
      .where(eq(productos.id_producto, idProducto));
  }

  // =========================================================================
  // CATÁLOGO COMPLETO PARA POS TÁCTIL (Pintado de botonera en 1 sola query)
  // =========================================================================

  async obtenerCatalogoPos() {
    const listaCategorias = await this.db
      .select()
      .from(categorias)
      .where(eq(categorias.eliminado, false))
      .orderBy(asc(categorias.orden_visual), asc(categorias.nombre));

    const listaProductos = await this.db
      .select()
      .from(productos)
      .where(eq(productos.eliminado, false))
      .orderBy(asc(productos.nombre));

    // Modificadores de todos los productos en 2 consultas (no una por producto).
    const gruposPorProducto = await this.modifiers.gruposPorProductos(listaProductos.map((p) => p.id_producto));

    // Agrupación en memoria optimizada
    return listaCategorias.map((cat) => ({
      ...cat,
      productos: listaProductos
        .filter((prod) => prod.id_categoria === cat.id_categoria)
        .map((prod) => ({ ...prod, grupos_modificadores: gruposPorProducto.get(prod.id_producto) ?? [] })),
    }));
  }
}