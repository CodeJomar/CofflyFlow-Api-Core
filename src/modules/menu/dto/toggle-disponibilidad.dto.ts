import { IsOptional, IsBoolean } from 'class-validator';

export class ToggleDisponibilidadDto {
  @IsOptional()
  @IsBoolean({ message: 'El campo disponible debe ser booleano.' })
  disponible?: boolean;
}