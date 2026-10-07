import { IsNotEmpty, IsIn } from 'class-validator';

export class UpdateItemKdsDto {
  @IsNotEmpty({ message: 'El estado KDS es obligatorio.' })
  @IsIn(['cola', 'preparando', 'despachado'], {
    message: 'El estado de cocina/barra debe ser: cola, preparando o despachado.',
  })
  estado_kds: string;
}