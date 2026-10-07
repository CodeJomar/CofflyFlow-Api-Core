import {
  IsNotEmpty,
  IsUUID,
  IsInt,
  Min,
  Max,
  ArrayMaxSize,
  ValidateNested,
  IsOptional,
  IsString,
  MaxLength,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

/**
 * Modificador elegido en una línea del pedido. El cliente solo indica QUÉ opción eligió: nombre, variación de
 * precio, disponibilidad y límites del grupo los resuelve el servidor desde el menú (MENU-003..008).
 */
export class ModificadorSeleccionDto {
  @IsNotEmpty({ message: 'El id_opcion es obligatorio.' })
  @IsUUID('4', { message: 'El id_opcion debe ser un UUID válido.' })
  id_opcion: string;
}

export class CreateOrderItemDto {
  @IsNotEmpty({ message: 'El id_producto es obligatorio.' })
  @IsUUID('4', { message: 'El id_producto debe ser un UUID válido.' })
  id_producto: string;

  @IsNotEmpty({ message: 'La cantidad es obligatoria.' })
  @Type(() => Number)
  @IsInt({ message: 'La cantidad debe ser un entero.' })
  @Min(1, { message: 'La cantidad mínima es 1.' })
  @Max(999, { message: 'La cantidad máxima por línea es 999.' })
  cantidad: number;

  // MENU-010: la nota libre es independiente de los modificadores estructurados.
  @IsOptional()
  @IsString({ message: 'Las notas de preparación deben ser texto.' })
  @MaxLength(255)
  @IsSafeText()
  notas_preparacion?: string;

  @IsOptional()
  @IsArray({ message: 'Los modificadores deben enviarse en formato de lista.' })
  @ArrayMaxSize(20, { message: 'Máximo 20 modificadores por producto.' })
  @ValidateNested({ each: true })
  @Type(() => ModificadorSeleccionDto)
  modificadores?: ModificadorSeleccionDto[];
}
