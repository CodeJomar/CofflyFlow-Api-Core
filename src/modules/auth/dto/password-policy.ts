import { applyDecorators } from '@nestjs/common';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Política única de contraseña nueva (activación y recuperación). */
export function PasswordNueva() {
  return applyDecorators(
    IsString({ message: 'La contraseña debe ser una cadena de texto.' }),
    IsNotEmpty({ message: 'La contraseña es obligatoria.' }),
    MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' }),
    MaxLength(72, { message: 'La contraseña no puede exceder los 72 caracteres.' }),
    Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'La contraseña debe incluir letras y números.' }),
  );
}
