import { IsNotEmpty, IsUUID, IsIn } from 'class-validator';

/** Quién despacha y a qué pedido pertenece el ítem lo determinan la sesión del socket y la base, nunca el cliente. */
export class UpdateItemSocketDto {
  @IsNotEmpty({ message: 'El id_pedido_detalle es obligatorio.' })
  @IsUUID('4', { message: 'id_pedido_detalle debe ser un UUID válido.' })
  id_pedido_detalle: string;

  @IsNotEmpty({ message: 'El estado KDS es obligatorio.' })
  @IsIn(['cola', 'preparando', 'despachado'], {
    message: 'El estado solo puede ser: cola, preparando o despachado.',
  })
  estado_kds: string;
}
