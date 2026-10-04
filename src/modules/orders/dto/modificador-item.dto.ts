import {
  IsNotEmpty,
  IsUUID,
  IsInt,
  Min,
  IsOptional,
  IsString,
  MaxLength,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

export class ModificadorItemDto {
  @IsNotEmpty()
  @IsString()
  @IsSafeText()
  tipo: string; // ej: "leche", "temperatura", "molienda", "adicional"

  @IsNotEmpty()
  @IsString()
  @IsSafeText()
  valor: string; // ej: "Almendras", "65°C", "Fina", "Huevo Poché"
}

export class CreateOrderItemDto {
  @IsNotEmpty({ message: 'El id_producto es obligatorio.' })
  @IsUUID('4', { message: 'El id_producto debe ser un UUID válido.' })
  id_producto: string;

  @IsNotEmpty({ message: 'La cantidad es obligatoria.' })
  @Type(() => Number)
  @IsInt({ message: 'La cantidad debe ser un entero.' })
  @Min(1, { message: 'La cantidad mínima es 1.' })
  cantidad: number;

  @IsOptional()
  @IsString({ message: 'Las notas de preparación deben ser texto.' })
  @MaxLength(255)
  @IsSafeText()
  notas_preparacion?: string;

  @IsOptional()
  @IsArray({ message: 'Los modificadores deben enviarse en formato de lista.' })
  modificadores?: ModificadorItemDto[];
}