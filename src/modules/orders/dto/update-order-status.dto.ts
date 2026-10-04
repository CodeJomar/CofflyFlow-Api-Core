import { IsNotEmpty, IsIn } from 'class-validator';

export class UpdateOrderStatusDto {
  @IsNotEmpty({ message: 'El estado del pedido es obligatorio.' })
  @IsIn(['pendiente', 'en_preparacion', 'listo', 'pagado', 'anulado'], {
    message: 'Estado inválido. Opciones: pendiente, en_preparacion, listo, pagado, anulado.',
  })
  estado: string;
}