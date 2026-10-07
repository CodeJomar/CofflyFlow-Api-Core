import { IsIn, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';
import { IsMoney } from '../../../common/validators/money.validator';

/**
 * Ajuste auditable sobre un turno YA CERRADO (TRX-008). El turno no se modifica: la corrección queda como una
 * transacción nueva marcada como ajuste, con su motivo y su autor.
 */
export class AjusteCajaDto {
  @IsIn(['ingreso_manual', 'retiro_manual'], { message: 'El tipo de ajuste debe ser ingreso_manual o retiro_manual.' })
  tipo_movimiento: string;

  @IsIn(['efectivo', 'tarjeta', 'yape', 'plin', 'transferencia'], { message: 'Método de pago no válido.' })
  metodo_pago: string;

  @IsMoney({ positivo: true })
  monto: string;

  @IsNotEmpty({ message: 'El motivo del ajuste es obligatorio.' })
  @IsString()
  @MinLength(5, { message: 'Explica el motivo del ajuste (mínimo 5 caracteres).' })
  @MaxLength(255)
  @IsSafeText()
  motivo: string;
}
