import { IsEmail, IsString, MaxLength, IsUUID, IsOptional, IsIn } from 'class-validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

export class UpdateUserDto {
  @IsOptional()
  @IsUUID('4', { message: 'El id_rol (cargo) debe ser un UUID v4 válido.' })
  id_rol?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El email proporcionado no tiene un formato válido.' })
  @MaxLength(150, { message: 'El email no puede superar los 150 caracteres.' })
  email?: string;

  @IsOptional()
  @IsString({ message: 'El nombre debe ser una cadena de texto.' })
  @MaxLength(100, { message: 'El nombre no puede superar los 100 caracteres.' })
  @IsSafeText()
  nombre?: string;

  // 'bloqueado' es un estado temporal que gestiona el sistema; 'pendiente_activacion' se resuelve por correo.
  @IsOptional()
  @IsIn(['activo', 'suspendido', 'inactivo'], { message: 'El estado solo puede ser activo, suspendido o inactivo.' })
  estado?: string;
}
