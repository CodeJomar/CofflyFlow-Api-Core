import { IsNotEmpty } from 'class-validator';
import { IsMoney } from '../../../common/validators/money.validator';

export class AperturaTurnoDto {
  @IsNotEmpty({ message: 'El monto inicial de caja es obligatorio.' })
  @IsMoney({}, { message: 'El monto inicial debe ser un monto no negativo con hasta 2 decimales (ej: "150.00").' })
  monto_inicial: string;
}