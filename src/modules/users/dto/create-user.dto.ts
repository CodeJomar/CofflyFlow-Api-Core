import { IsEmail, IsNotEmpty, IsString, MaxLength, IsUUID, Matches, IsOptional } from 'class-validator';
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

  /** Documento de identidad (DNI o similar). */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-Za-z-]{6,15}$/, { message: 'El documento debe tener entre 6 y 15 letras, números o guiones.' })
  dni?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+() -]{6,20}$/, { message: 'El teléfono solo admite números, +, espacios, guiones y paréntesis (6 a 20 caracteres).' })
  telefono?: string;

  /** Fecha de ingreso (YYYY-MM-DD). */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha de ingreso debe tener formato YYYY-MM-DD.' })
  fecha_ingreso?: string;
}
