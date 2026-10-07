import { IsNotEmpty, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateOrderStatusDto {
  @IsNotEmpty({ message: 'El estado del pedido es obligatorio.' })
  // 'pagado' NO se puede fijar desde aquí: solo lo establece el cobro en Caja (POST /transactions/cobrar).
  @IsIn(['pendiente', 'en_preparacion', 'listo', 'anulado'], {
    message: 'Estado inválido. Opciones: pendiente, en_preparacion, listo, anulado. El cobro se registra desde Caja.',
  })
  estado: string;

  /** Obligatorio al anular o al revertir el estado (ORD-008); se guarda en la auditoría. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El motivo debe ser texto.' })
  @MaxLength(200, { message: 'El motivo admite como máximo 200 caracteres.' })
  motivo?: string;
}
