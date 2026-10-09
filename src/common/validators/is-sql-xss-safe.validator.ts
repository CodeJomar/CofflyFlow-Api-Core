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

// Texto normal de una cafetería: letras (con tildes), números, espacios y la puntuación de uso común. Quedan fuera los
// emojis y los símbolos raros, y las rachas de símbolos seguidos ("!\"#$%&" no es un texto real).
const TEXTO_PERMITIDO = /^[\p{L}\p{M}\p{N}\s.,;:()¡!¿?'"%/+\-_&#@$°ºª]*$/u;
const RACHA_DE_SIMBOLOS = /[^\p{L}\p{M}\p{N}\s.]{3,}|[^\p{L}\p{M}\p{N}\s]{4,}/u;
// Nombre de persona: letras, espacios y . ' - sueltos (sin dos signos seguidos ni signos al inicio).
const NOMBRE_PERSONA = /^(?!.*(?:[.'-]{2}|\s{2}))[\p{L}\p{M}][\p{L}\p{M}'.\- ]*$/u;

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
    return !ETIQUETA_HTML.test(valor) && TEXTO_PERMITIDO.test(valor) && !RACHA_DE_SIMBOLOS.test(valor);
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

@ValidatorConstraint({ name: 'IsPersonName', async: false })
@Injectable()
export class IsPersonNameConstraint implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    return typeof valor !== 'string' || NOMBRE_PERSONA.test(valor.trim());
  }

  defaultMessage(args: ValidationArguments): string {
    return `El campo '${args.property}' solo admite letras, espacios, punto, apóstrofe y guion.`;
  }
}

/** Nombre de una persona (empleado, cliente): letras con tildes y los signos . ' - sueltos; sin números ni símbolos. */
export function IsPersonName(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsPersonNameConstraint,
    });
  };
}
