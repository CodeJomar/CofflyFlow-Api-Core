import { IsEmail, IsNotEmpty, IsString, MaxLength, IsUUID } from 'class-validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

/**
 * Alta de empleado. No lleva contraseña: la cuenta nace "pendiente de activación" y el empleado
 * define su contraseña desde el correo de activación. `id_rol` identifica el cargo operativo.
 */
export class CreateUserDto {
  @IsUUID('4', { message: 'El id_rol (cargo) debe ser un UUID v4 válido.' })
  @IsNotEmpty({ message: 'El cargo (id_rol) es obligatorio.' })
  id_rol: string;

  @IsEmail({}, { message: 'El email proporcionado no tiene un formato válido.' })
  @IsNotEmpty({ message: 'El email es obligatorio.' })
  @MaxLength(150, { message: 'El email no puede superar los 150 caracteres.' })
  email: string;

  @IsString({ message: 'El nombre debe ser una cadena de texto.' })
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(100, { message: 'El nombre no puede superar los 100 caracteres.' })
  @IsSafeText()
  nombre: string;
}
