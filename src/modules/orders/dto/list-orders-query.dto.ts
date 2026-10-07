import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../core/dto/pagination-query.dto';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros del listado de pedidos (vista Pedidos). Sin filtros: los pedidos de hoy (hora de Lima). */
export class ListOrdersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['pendiente', 'en_preparacion', 'listo', 'pagado', 'anulado'], { message: 'Estado de pedido inválido.' })
  estado?: string;

  @IsOptional()
  @IsIn(['salon', 'llevar', 'delivery'], { message: 'El tipo de pedido debe ser: salon, llevar o delivery.' })
  tipo_pedido?: string;

  @IsOptional()
  @IsUUID('4', { message: 'id_mesa debe ser un UUID válido.' })
  id_mesa?: string;

  @IsOptional()
  @Matches(FECHA, { message: 'fecha_inicio debe tener formato YYYY-MM-DD.' })
  fecha_inicio?: string;

  @IsOptional()
  @Matches(FECHA, { message: 'fecha_fin debe tener formato YYYY-MM-DD.' })
  fecha_fin?: string;
}
