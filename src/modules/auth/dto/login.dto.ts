import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

export class LoginDto {
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio.' })
  @IsEmail({}, { message: 'El formato del correo electrónico es inválido.' })
  @MaxLength(150, { message: 'El correo no puede exceder los 150 caracteres.' })
  email: string;

  @IsNotEmpty({ message: 'La contraseña es obligatoria.' })
  @IsString({ message: 'La contraseña debe ser una cadena de texto.' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres.' })
  @MaxLength(100, { message: 'La contraseña no puede exceder los 100 caracteres.' })
  @IsSafeText()
  password: string;
}