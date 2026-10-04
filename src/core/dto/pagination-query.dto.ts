import { IsOptional, IsInt, Min, Max, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La página debe ser un número entero.' })
  @Min(1, { message: 'La página mínima permitida es 1.' })
  pagina?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El límite debe ser un número entero.' })
  @Min(1, { message: 'El límite mínimo permitido es 1.' })
  @Max(100, { message: 'El límite máximo permitido por página es 100.' })
  limite?: number = 10;

  @IsOptional()
  @IsString({ message: 'El campo de búsqueda debe ser una cadena de texto.' })
  busqueda?: string;

  @IsOptional()
  @IsString({ message: 'El campo de ordenamiento debe ser una cadena de texto.' })
  ordenar_por?: string = 'fecha_creacion';

  @IsOptional()
  @IsIn(['asc', 'desc', 'ASC', 'DESC'], { message: 'El orden solo puede ser asc o desc.' })
  orden?: 'asc' | 'desc' | 'ASC' | 'DESC' = 'desc';
}