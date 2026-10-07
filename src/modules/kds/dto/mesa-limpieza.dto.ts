import { IsNotEmpty, IsUUID, IsIn } from 'class-validator';

/** 'Marcar Lista': la mesa pendiente de limpieza pasa a libre. Es el único cambio de estado que se hace por socket. */
export class MesaLimpiezaDto {
  @IsNotEmpty({ message: 'El id_mesa es obligatorio.' })
  @IsUUID('4', { message: 'id_mesa debe ser un UUID válido.' })
  id_mesa: string;

  @IsNotEmpty({ message: 'El estado es obligatorio.' })
  @IsIn(['libre'], { message: 'Desde el KDS una mesa solo puede marcarse como libre (limpieza lista).' })
  nuevo_estado: string;
}
