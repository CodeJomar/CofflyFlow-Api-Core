import { IsEmail, IsNotEmpty, IsString, Length, Matches, MaxLength } from 'class-validator';
import { PasswordNueva } from './password-policy';

export class SolicitarRecuperacionDto {
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio.' })
  @IsEmail({}, { message: 'El formato del correo electrónico es inválido.' })
  @MaxLength(150)
  email: string;
}

export class VerificarOtpDto {
  @IsNotEmpty()
  @IsEmail({}, { message: 'El formato del correo electrónico es inválido.' })
  @MaxLength(150)
  email: string;

  @IsString()
  @Length(6, 6, { message: 'El código debe tener 6 dígitos.' })
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos.' })
  codigo: string;
}

export class RestablecerPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'El token de restablecimiento es obligatorio.' })
  @MaxLength(200)
  token: string;

  @PasswordNueva()
  nueva_password: string;
}

export class ActivarCuentaDto {
  @IsString()
  @IsNotEmpty({ message: 'El token de activación es obligatorio.' })
  @MaxLength(200)
  token: string;

  @PasswordNueva()
  password: string;
}

export class ValidarActivacionDto {
  @IsString()
  @IsNotEmpty({ message: 'El token de activación es obligatorio.' })
  @MaxLength(200)
  token: string;
}
