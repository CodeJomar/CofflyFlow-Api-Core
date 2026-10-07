import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../core/dto/pagination-query.dto';

/** Filtros del listado de productos. Antes se recibían sin validar (un id_categoria inválido llegaba hasta la base). */
export class ListProductosQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'El id_categoria debe ser un UUID válido.' })
  id_categoria?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean({ message: 'solo_disponibles debe ser true o false.' })
  solo_disponibles?: boolean;
}
