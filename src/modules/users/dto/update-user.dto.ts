import { IsEmail, IsString, MaxLength, IsUUID, IsOptional, IsIn, Matches } from 'class-validator';
import { IsSafeText, IsPersonName } from '../../../common/validators/is-sql-xss-safe.validator';

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
  @IsPersonName()
  nombre?: string;

  // 'bloqueado' es un estado temporal que gestiona el sistema; 'pendiente_activacion' se resuelve por correo.
  @IsOptional()
  @IsIn(['activo', 'suspendido', 'inactivo'], { message: 'El estado solo puede ser activo, suspendido o inactivo.' })
  estado?: string;

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
