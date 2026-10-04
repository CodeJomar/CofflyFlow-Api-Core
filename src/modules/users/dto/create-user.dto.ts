import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength, IsUUID, IsOptional, IsIn } from 'class-validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

export class CreateUserDto {
  @IsUUID('4', { message: 'El id_rol debe ser un UUID v4 válido.' })
  @IsNotEmpty({ message: 'El id_rol es obligatorio.' })
  id_rol: string;

  @IsEmail({}, { message: 'El email proporcionado no tiene un formato válido.' })
  @IsNotEmpty({ message: 'El email es obligatorio.' })
  @MaxLength(150, { message: 'El email no puede superar los 150 caracteres.' })
  email: string;

  @IsString({ message: 'La contraseña debe ser una cadena de texto.' })
  @IsNotEmpty({ message: 'La contraseña es obligatoria.' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(100, { message: 'La contraseña no puede exceder los 100 caracteres.' })
  password: string;

  @IsString({ message: 'El nombre debe ser una cadena de texto.' })
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(100, { message: 'El nombre no puede superar los 100 caracteres.' })
  @IsSafeText()
  nombre: string;

  @IsOptional()
  @IsIn(['activo', 'inactivo'], { message: 'El estado solo puede ser activo o inactivo.' })
  estado?: string = 'activo';
}