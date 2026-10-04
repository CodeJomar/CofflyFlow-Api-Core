import { IsNotEmpty, IsUUID, IsIn } from 'class-validator';

export class MesaLimpiezaDto {
  @IsNotEmpty({ message: 'El id_mesa es obligatorio.' })
  @IsUUID('4', { message: 'id_mesa debe ser un UUID válido.' })
  id_mesa: string;

  @IsNotEmpty({ message: 'El estado es obligatorio.' })
  @IsIn(['libre', 'ocupada', 'por_cobrar', 'por_limpiar'], {
    message: 'El estado debe ser: libre, ocupada, por_cobrar o por_limpiar.',
  })
  nuevo_estado: string;
}