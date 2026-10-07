import { IsNotEmpty, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { IsMoney } from '../../../common/validators/money.validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

/** Devolución (total o parcial) de un cobro. Sale del turno de caja abierto y exige motivo. */
export class DevolucionDto {
  @IsNotEmpty({ message: 'Indica el cobro que se devuelve (id_transaccion_origen).' })
  @IsUUID('4', { message: 'id_transaccion_origen debe ser un UUID válido.' })
  id_transaccion_origen: string;

  @IsNotEmpty({ message: 'El monto a devolver es obligatorio.' })
  @IsMoney({ positivo: true })
  monto: string;

  @IsNotEmpty({ message: 'El motivo de la devolución es obligatorio.' })
  @IsString()
  @MinLength(3, { message: 'El motivo debe tener al menos 3 caracteres.' })
  @MaxLength(255)
  @IsSafeText()
  motivo: string;
}
