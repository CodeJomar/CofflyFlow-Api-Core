import { IsNotEmpty, IsNumberString } from 'class-validator';

export class AperturaTurnoDto {
  @IsNotEmpty({ message: 'El monto inicial de caja es obligatorio.' })
  @IsNumberString({}, { message: 'El monto inicial debe ser un número decimal válido (ej: "150.00").' })
  monto_inicial: string;
}