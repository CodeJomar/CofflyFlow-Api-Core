import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';
import { IsMoney } from '../../../common/validators/money.validator';

export class AperturaTurnoDto {
  @IsNotEmpty({ message: 'El monto inicial de caja es obligatorio.' })
  @IsMoney({}, { message: 'El monto inicial debe ser un monto no negativo con hasta 2 decimales (ej: "150.00").' })
  monto_inicial: string;

  /** Nota opcional de la apertura (por ejemplo, quién entregó el fondo). */
  @IsOptional()
  @IsString({ message: 'La nota de apertura debe ser texto.' })
  @MaxLength(255, { message: 'La nota de apertura no puede superar los 255 caracteres.' })
  @IsSafeText()
  nota_apertura?: string;
}