import { IsNotEmpty, IsIn } from 'class-validator';

export class ChangeTableStatusDto {
  @IsNotEmpty({ message: 'El nuevo estado de la mesa es obligatorio.' })
  @IsIn(['libre', 'ocupada', 'por_cobrar'], {
    message: 'El estado debe ser: libre, ocupada o por_cobrar.',
  })
  estado: string;
}