import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

/** Datos opcionales de la baja de un empleado. */
export class BajaUserDto {
  @IsOptional()
  @IsString({ message: 'El motivo de la baja debe ser texto.' })
  @MaxLength(255, { message: 'El motivo no puede superar los 255 caracteres.' })
  @IsSafeText()
  motivo?: string;
}
