import { Injectable } from '@nestjs/common';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

// Etiquetas HTML con forma de marcado (<script>, <img onerror=...>, <a href=...>). Un "<" suelto o "a < b" es texto normal.
const ETIQUETA_HTML = /<\/?[a-z][\w-]*(\s+[^<>]*)?\/?>/i;

/**
 * Rechaza marcado HTML en campos de texto libre (defensa en profundidad contra XSS almacenado: la API solo guarda
 * texto plano). NO filtra palabras SQL: las consultas van parametrizadas (Drizzle), así que "delete from" en una
 * nota es texto legítimo y bloquearlo solo daría falsos positivos.
 */
@ValidatorConstraint({ name: 'IsSafeText', async: false })
@Injectable()
export class IsSafeTextConstraint implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    if (typeof valor !== 'string') return true;
    return !ETIQUETA_HTML.test(valor);
  }

  defaultMessage(args: ValidationArguments): string {
    return `El campo '${args.property}' no admite etiquetas HTML.`;
  }
}

/**
 * @example
 * ```ts
 * @IsSafeText()
 * nombre: string;
 * ```
 */
export function IsSafeText(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsSafeTextConstraint,
    });
  };
}
