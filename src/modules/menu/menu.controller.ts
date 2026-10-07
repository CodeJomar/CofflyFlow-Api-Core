import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MenuService } from './menu.service';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { ToggleDisponibilidadDto } from './dto/toggle-disponibilidad.dto';
import { ListProductosQueryDto } from './dto/list-productos-query.dto';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { MODULO, ACCION } from '../../common/security/permission-matrix';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OneQuery } from '../../core/dto/one-query.dto';
import { DataQuery } from '../../core/dto/data-query.dto';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';

@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  // =========================================================================
  // ENDPOINTS DE CATEGORÍAS
  // =========================================================================

  @Post('categorias')
  @RequirePermission(MODULO.MENU, ACCION.CREAR)
  @HttpCode(HttpStatus.CREATED)
  async crearCategoria(
    @Body() dto: CreateCategoriaDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const categoria = await this.menuService.crearCategoria(dto, idOperador);
    return new OneQuery(categoria, 'CREATED', [
      new MensajeQuery('CAT_201', 'Categoría creada exitosamente.'),
    ]);
  }

  @Get('categorias')
  @RequirePermission(MODULO.MENU, ACCION.LEER)
  async listarCategorias(): Promise<CheckStatus<unknown>> {
    const categorias = await this.menuService.listarCategorias();
    return new CheckStatus('OK', [new MensajeQuery('CAT_200', 'Listado de categorías.')], '', categorias);
  }

  @Patch('categorias/:id')
  @RequirePermission(MODULO.MENU, ACCION.EDITAR)
  async actualizarCategoria(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateCategoriaDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const categoria = await this.menuService.actualizarCategoria(id, dto, idOperador);
    return new OneQuery(categoria, 'OK', [
      new MensajeQuery('CAT_200', 'Categoría actualizada exitosamente.'),
    ]);
  }

  @Delete('categorias/:id')
  @RequirePermission(MODULO.MENU, ACCION.ELIMINAR)
  async eliminarCategoria(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<CheckStatus<null>> {
    await this.menuService.eliminarCategoria(id, idOperador);
    return new CheckStatus('OK', [new MensajeQuery('CAT_200', 'Categoría dada de baja.')], '', null);
  }

  // =========================================================================
  // ENDPOINTS DE PRODUCTOS
  // =========================================================================

  @Post('productos')
  @RequirePermission(MODULO.MENU, ACCION.CREAR)
  @HttpCode(HttpStatus.CREATED)
  async crearProducto(
    @Body() dto: CreateProductoDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const producto = await this.menuService.crearProducto(dto, idOperador);
    return new OneQuery(producto, 'CREATED', [
      new MensajeQuery('PROD_201', 'Producto creado exitosamente.'),
    ]);
  }

  @Get('productos')
  @RequirePermission(MODULO.MENU, ACCION.LEER)
  async listarProductos(@Query() query: ListProductosQueryDto): Promise<DataQuery<unknown>> {
    const { items, total } = await this.menuService.listarProductos(query);

    return new DataQuery(
      items,
      total,
      Number(query.pagina) || 1,
      Number(query.limite) || 10,
      'OK',
      [new MensajeQuery('PROD_200', 'Listado de productos recuperado.')],
    );
  }

  @Get('productos/:id')
  @RequirePermission(MODULO.MENU, ACCION.LEER)
  async obtenerProductoPorId(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OneQuery<unknown>> {
    const producto = await this.menuService.obtenerProductoPorId(id);
    return new OneQuery(producto, 'OK', [
      new MensajeQuery('PROD_200', 'Detalle de producto recuperado.'),
    ]);
  }

  @Patch('productos/:id')
  @RequirePermission(MODULO.MENU, ACCION.EDITAR)
  async actualizarProducto(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateProductoDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const producto = await this.menuService.actualizarProducto(id, dto, idOperador);
    return new OneQuery(producto, 'OK', [
      new MensajeQuery('PROD_200', 'Producto actualizado correctamente.'),
    ]);
  }

  /**
   * TOGGLE TÁCTIL RÁPIDO (Disponible para Cajero, Barista, Mesero y Admin)
   */
  @Patch('productos/:id/toggle-disponibilidad')
  @RequirePermission(MODULO.MENU, ACCION.DISPONIBILIDAD)
  async conmutarDisponibilidad(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ToggleDisponibilidadDto,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<OneQuery<unknown>> {
    const producto = await this.menuService.conmutarDisponibilidad(id, dto.disponible, idOperador);
    return new OneQuery(producto, 'OK', [
      new MensajeQuery('PROD_200', `Disponibilidad cambiada a ${producto.disponible ? 'Disponible' : 'Agotado'}.`),
    ]);
  }

  @Delete('productos/:id')
  @RequirePermission(MODULO.MENU, ACCION.ELIMINAR)
  async eliminarProducto(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser('id_usuario') idOperador: string,
  ): Promise<CheckStatus<null>> {
    await this.menuService.eliminarProducto(id, idOperador);
    return new CheckStatus('OK', [new MensajeQuery('PROD_200', 'Producto dado de baja.')], '', null);
  }

  // =========================================================================
  // VISTA CONSOLIDADA POS (Botonera táctil)
  // =========================================================================

  @Get('catalogo-pos')
  @RequirePermission(MODULO.MENU, ACCION.LEER)
  async obtenerCatalogoPos(): Promise<CheckStatus<unknown>> {
    const data = await this.menuService.obtenerCatalogoPos();
    return new CheckStatus('OK', [new MensajeQuery('POS_200', 'Catálogo POS recuperado.')], '', data);
  }
}