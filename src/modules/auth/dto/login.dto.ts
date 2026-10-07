import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio.' })
  @IsEmail({}, { message: 'El formato del correo electrónico es inválido.' })
  @MaxLength(150, { message: 'El correo no puede exceder los 150 caracteres.' })
  email: string;

  // Sin validación de formato ni IsSafeText: la contraseña solo se compara contra el hash.
  @IsNotEmpty({ message: 'La contraseña es obligatoria.' })
  @IsString({ message: 'La contraseña debe ser una cadena de texto.' })
  @MaxLength(100, { message: 'La contraseña no puede exceder los 100 caracteres.' })
  password: string;
}
