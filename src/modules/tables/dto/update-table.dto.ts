import { IsOptional, IsString, MaxLength, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

/**
 * Configuración de la mesa. El ESTADO no se edita aquí: lo mueve la operación (pedidos, cobro, limpieza) o
 * PATCH /tables/:id/estado con reglas de transición.
 */
export class UpdateTableDto {
  @IsOptional()
  @IsString({ message: 'El identificador debe ser una cadena de texto.' })
  @MaxLength(10, { message: 'El identificador no puede exceder los 10 caracteres.' })
  @IsSafeText()
  numero?: string;

  @IsOptional()
  @IsString({ message: 'El área debe ser una cadena de texto.' })
  @MaxLength(30, { message: 'El área no puede exceder los 30 caracteres.' })
  @IsSafeText()
  area?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La capacidad debe ser un número entero.' })
  @Min(1, { message: 'La capacidad mínima debe ser de al menos 1 persona.' })
  @Max(50, { message: 'La capacidad máxima es de 50 personas.' })
  capacidad?: number;
}
