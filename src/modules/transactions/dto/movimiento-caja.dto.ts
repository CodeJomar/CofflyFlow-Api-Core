import { IsNotEmpty, IsUUID, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsMoney } from '../../../common/validators/money.validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

export class MovimientoCajaDto {
  /** Opcional: el movimiento se registra en el turno de caja abierto. Si se envía, debe ser ese turno. */
  @IsOptional()
  @IsUUID('4', { message: 'id_turno_caja debe ser un UUID válido.' })
  id_turno_caja?: string;

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
  @IsMoney({ positivo: true })
  monto: string;

  /** Motivo del movimiento (TRX-005): obligatorio. */
  @IsNotEmpty({ message: 'El motivo del movimiento es obligatorio.' })
  @IsString()
  @MinLength(3, { message: 'El motivo debe tener al menos 3 caracteres.' })
  @MaxLength(255)
  @IsSafeText()
  notas: string;
}