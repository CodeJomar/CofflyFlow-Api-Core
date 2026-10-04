import {
  IsOptional,
  IsString,
  MaxLength,
  IsUUID,
  IsNumberString,
  IsBoolean,
} from 'class-validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

export class UpdateProductoDto {
  @IsOptional()
  @IsUUID('4', { message: 'El id_categoria debe ser un UUID válido.' })
  id_categoria?: string;

  @IsOptional()
  @IsString({ message: 'El nombre debe ser una cadena de texto.' })
  @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres.' })
  @IsSafeText()
  nombre?: string;

  @IsOptional()
  @IsString({ message: 'La descripción debe ser una cadena de texto.' })
  @MaxLength(500, { message: 'La descripción no puede exceder los 500 caracteres.' })
  @IsSafeText()
  descripcion?: string;

  @IsOptional()
  @IsNumberString({}, { message: 'El precio debe ser un número decimal válido (ej: "12.50").' })
  precio?: string;

  @IsOptional()
  @IsBoolean({ message: 'La disponibilidad debe ser true o false.' })
  disponible?: boolean;
}