import { IsNotEmpty, IsUUID, IsIn, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

export class MovimientoCajaDto {
  @IsNotEmpty({ message: 'El id_turno_caja es obligatorio.' })
  @IsUUID('4', { message: 'id_turno_caja debe ser un UUID válido.' })
  id_turno_caja: string;

  @IsNotEmpty({ message: 'El tipo de movimiento es obligatorio.' })
  @IsIn(['ingreso_manual', 'retiro_manual'], {
    message: 'El tipo de movimiento debe ser ingreso_manual o retiro_manual.',
  })
  tipo_movimiento: string;

  @IsNotEmpty({ message: 'El método de pago es obligatorio.' })
  @IsIn(['efectivo', 'tarjeta', 'yape', 'plin', 'transferencia'], {
    message: 'Método de pago no válido.',
  })
  metodo_pago: string;

  @IsNotEmpty({ message: 'El monto del movimiento es obligatorio.' })
  @IsNumberString({}, { message: 'El monto debe ser un número decimal válido.' })
  monto: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @IsSafeText()
  notas?: string;
}