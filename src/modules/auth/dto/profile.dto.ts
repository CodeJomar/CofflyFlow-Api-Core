import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PasswordNueva } from './password-policy';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

/** Cambio de contraseña desde el perfil: exige la contraseña actual (reautenticación). */
export class CambiarPasswordDto {
  @IsString({ message: 'La contraseña actual debe ser texto.' })
  @IsNotEmpty({ message: 'Indica tu contraseña actual.' })
  @MaxLength(72, { message: 'La contraseña actual no puede exceder los 72 caracteres.' })
  password_actual: string;

  @PasswordNueva()
  password_nueva: string;
}

/** El correo y el cargo no se editan desde el perfil; solo el nombre para mostrar. */
export class ActualizarPerfilDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El nombre debe ser texto.' })
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(100, { message: 'El nombre no puede superar los 100 caracteres.' })
  @IsSafeText()
  nombre: string;
}
