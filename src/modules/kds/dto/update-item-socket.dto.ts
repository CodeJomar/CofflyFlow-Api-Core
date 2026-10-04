import { IsNotEmpty, IsUUID, IsIn, IsOptional } from 'class-validator';

export class UpdateItemSocketDto {
  @IsNotEmpty({ message: 'El id_pedido es obligatorio.' })
  @IsUUID('4', { message: 'id_pedido debe ser un UUID válido.' })
  id_pedido: string;

  @IsNotEmpty({ message: 'El id_pedido_detalle es obligatorio.' })
  @IsUUID('4', { message: 'id_pedido_detalle debe ser un UUID válido.' })
  id_pedido_detalle: string;

  @IsNotEmpty({ message: 'El estado KDS es obligatorio.' })
  @IsIn(['cola', 'preparando', 'despachado'], {
    message: 'El estado solo puede ser: cola, preparando o despachado.',
  })
  estado_kds: string;

  @IsOptional()
  @IsUUID('4', { message: 'El despachado_por debe ser un UUID.' })
  despachado_por?: string;
}