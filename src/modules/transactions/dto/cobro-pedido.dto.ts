import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsMoney } from '../../../common/validators/money.validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

export const METODOS_PAGO = ['efectivo', 'tarjeta', 'yape', 'plin', 'transferencia'] as const;

/** Una línea de pago: cuánto y con qué método. Varias líneas = pago mixto. */
export class LineaPagoDto {
  @IsNotEmpty({ message: 'El método de pago es obligatorio.' })
  @IsIn(METODOS_PAGO, { message: 'Método de pago no admitido (efectivo, tarjeta, yape, plin, transferencia).' })
  metodo_pago: string;

  @IsNotEmpty({ message: 'El monto de cada pago es obligatorio.' })
  @IsMoney({ positivo: true })
  monto: string;
}

/**
 * Cobro de un pedido. `pagos` puede sumar el total (pedido pagado) o solo una parte (cada comensal paga lo suyo): el
 * pedido queda pagado cuando lo cobrado cubre su total. Va con la cabecera Idempotency-Key obligatoria.
 */
export class CobroPedidoDto {
  @IsNotEmpty({ message: 'El id_pedido es obligatorio.' })
  @IsUUID('4', { message: 'id_pedido debe ser un UUID válido.' })
  id_pedido: string;

  /** Opcional: el cobro se registra en el turno de caja abierto. Si se envía, debe ser ese turno. */
  @IsOptional()
  @IsUUID('4', { message: 'id_turno_caja debe ser un UUID válido.' })
  id_turno_caja?: string;

  @IsArray({ message: 'pagos debe ser una lista.' })
  @ArrayMinSize(1, { message: 'Indica al menos un pago.' })
  @ArrayMaxSize(6, { message: 'Un cobro admite como máximo 6 líneas de pago.' })
  @ValidateNested({ each: true })
  @Type(() => LineaPagoDto)
  pagos: LineaPagoDto[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @IsSafeText()
  notas?: string;
}
