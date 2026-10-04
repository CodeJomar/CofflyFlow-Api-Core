import { IsNotEmpty, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

export class CierreTurnoDto {
  @IsNotEmpty({ message: 'El monto final real contado es obligatorio para el arqueo.' })
  @IsNumberString({}, { message: 'El monto final debe ser un número decimal válido (ej: "450.50").' })
  monto_final_real: string;

  @IsOptional()
  @IsString({ message: 'Las notas de cierre deben ser texto.' })
  @MaxLength(500, { message: 'Las notas no pueden superar los 500 caracteres.' })
  @IsSafeText()
  notas_cierre?: string;
}