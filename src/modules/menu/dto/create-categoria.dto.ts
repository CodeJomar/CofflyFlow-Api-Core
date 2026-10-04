import { IsNotEmpty, IsString, MaxLength, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

export class CreateCategoriaDto {
  @IsNotEmpty({ message: 'El nombre de la categoría es obligatorio.' })
  @IsString({ message: 'El nombre debe ser una cadena de texto.' })
  @MaxLength(50, { message: 'El nombre no puede exceder los 50 caracteres.' })
  @IsSafeText()
  nombre: string;

  @IsOptional()
  @IsString({ message: 'La descripción debe ser una cadena de texto.' })
  @MaxLength(255, { message: 'La descripción no puede exceder los 255 caracteres.' })
  @IsSafeText()
  descripcion?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El orden visual debe ser un número entero.' })
  @Min(0, { message: 'El orden visual no puede ser negativo.' })
  orden_visual?: number = 0;
}