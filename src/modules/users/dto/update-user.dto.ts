import { IsEmail, IsString, MaxLength, IsUUID, IsOptional, IsIn, MinLength } from 'class-validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

export class UpdateUserDto {
  @IsOptional()
  @IsUUID('4', { message: 'El id_rol debe ser un UUID v4 válido.' })
  id_rol?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El email proporcionado no tiene un formato válido.' })
  @MaxLength(150, { message: 'El email no puede superar los 150 caracteres.' })
  email?: string;

  @IsOptional()
  @IsString({ message: 'La contraseña debe ser una cadena de texto.' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(100, { message: 'La contraseña no puede exceder los 100 caracteres.' })
  password?: string;

  @IsOptional()
  @IsString({ message: 'El nombre debe ser una cadena de texto.' })
  @MaxLength(100, { message: 'El nombre no puede superar los 100 caracteres.' })
  @IsSafeText()
  nombre?: string;

  @IsOptional()
  @IsIn(['activo', 'inactivo', 'bloqueado'], { message: 'El estado solo puede ser activo, inactivo o bloqueado.' })
  estado?: string;
}