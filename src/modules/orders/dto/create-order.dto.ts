import {
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsIn,
  IsString,
  MaxLength,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';
import { CreateOrderItemDto } from './modificador-item.dto';
import { IsMoney } from '../../../common/validators/money.validator';

export class CreateOrderDto {
  @IsOptional()
  @IsUUID('4', { message: 'El id_mesa debe ser un UUID válido.' })
  id_mesa?: string;

  /** Opcional: la comanda se asocia al turno de caja abierto. Si se envía, debe ser ese turno. */
  @IsOptional()
  @IsUUID('4', { message: 'El id_turno_caja debe ser un UUID válido.' })
  id_turno_caja?: string;

  @IsOptional()
  @IsIn(['salon', 'llevar', 'delivery'], {
    message: 'El tipo de pedido debe ser: salon, llevar o delivery.',
  })
  tipo_pedido?: string = 'salon';

  /** Nombre del cliente (opcional): sirve para llamarlo cuando el pedido está listo. */
  @IsOptional()
  @IsString({ message: 'El nombre del cliente debe ser texto.' })
  @MaxLength(100, { message: 'El nombre del cliente no puede superar los 100 caracteres.' })
  @IsSafeText()
  cliente_nombre?: string;

  @IsOptional()
  @IsMoney({}, { message: 'El descuento debe ser un monto no negativo con hasta 2 decimales (ej: "2.50").' })
  descuento?: string = '0.00';

  @IsNotEmpty({ message: 'El pedido debe contener al menos un producto.' })
  @IsArray({ message: 'Los items deben enviarse como una lista.' })
  @ArrayMinSize(1, { message: 'El pedido debe contener al menos 1 producto.' })
  @ArrayMaxSize(100, { message: 'Un pedido admite como máximo 100 líneas.' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}