import {
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsIn,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsNumberString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateOrderItemDto } from './create-order.dto';

export class CreateOrderDto {
  @IsOptional()
  @IsUUID('4', { message: 'El id_mesa debe ser un UUID válido.' })
  id_mesa?: string; // Opcional para pedidos para llevar / delivery

  @IsNotEmpty({ message: 'El id_turno_caja es obligatorio para registrar la comanda.' })
  @IsUUID('4', { message: 'El id_turno_caja debe ser un UUID válido.' })
  id_turno_caja: string;

  @IsOptional()
  @IsIn(['salon', 'llevar', 'delivery'], {
    message: 'El tipo de pedido debe ser: salon, llevar o delivery.',
  })
  tipo_pedido?: string = 'salon';

  @IsOptional()
  @IsNumberString({}, { message: 'El descuento debe ser un valor decimal válido.' })
  descuento?: string = '0.00';

  @IsNotEmpty({ message: 'El pedido debe contener al menos un producto.' })
  @IsArray({ message: 'Los items deben enviarse como una lista.' })
  @ArrayMinSize(1, { message: 'El pedido debe contener al menos 1 producto.' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}