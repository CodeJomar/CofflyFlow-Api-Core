import {
  IsNotEmpty,
  IsString,
  MaxLength,
  IsOptional,
  IsUUID,
  IsBoolean,
} from 'class-validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';
import { IsMoney } from '../../../common/validators/money.validator';

export class CreateProductoDto {
  @IsNotEmpty({ message: 'La categoría es obligatoria.' })
  @IsUUID('4', { message: 'El id_categoria debe ser un UUID válido.' })
  id_categoria: string;

  @IsNotEmpty({ message: 'El nombre del producto es obligatorio.' })
  @IsString({ message: 'El nombre debe ser una cadena de texto.' })
  @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres.' })
  @IsSafeText()
  nombre: string;

  @IsOptional()
  @IsString({ message: 'La descripción debe ser una cadena de texto.' })
  @MaxLength(500, { message: 'La descripción no puede exceder los 500 caracteres.' })
  @IsSafeText()
  descripcion?: string;

  @IsNotEmpty({ message: 'El precio es obligatorio.' })
  @IsMoney({ positivo: true })
  precio: string;

  @IsOptional()
  @IsBoolean({ message: 'La disponibilidad debe ser true o false.' })
  disponible?: boolean = true;
}