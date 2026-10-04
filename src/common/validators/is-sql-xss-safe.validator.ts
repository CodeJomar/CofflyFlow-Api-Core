import { Injectable } from '@nestjs/common';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

@ValidatorConstraint({ name: 'IsSqlXssSafe', async: false })
@Injectable()
export class IsSqlXssSafe implements ValidatorConstraintInterface {
  validate(valor: unknown, args: ValidationArguments): boolean {
    if (!valor || typeof valor !== 'string') return true;
    const valorEnMayusculas = valor.toUpperCase();

    // 1. Detectar acceso a metadatos o subqueries peligrosas
    const regMetadatos = /\b(DB_NAME|SCHEMA_NAME|TABLE_NAME|INFORMATION_SCHEMA\.TABLES|CURRENT_USER)\b/;
    if (regMetadatos.test(valorEnMayusculas) && /\bEXEC(UTE)?\b/.test(valorEnMayusculas)) {
      return false;
    }

    // 2. Detectar comandos destructivos
    const nuevoValor = valorEnMayusculas.replaceAll(/\s\s+/g, ' ');
    const declaracionesProhibidas = [
      '\\bALTER\\s+TABLE\\b', '\\bCREATE\\s+TABLE\\b', '\\bDROP\\s+TABLE\\b',
      '\\bTRUNCATE\\s+TABLE\\b', '\\bINSERT\\s+INTO\\b', '\\bDELETE\\s+FROM\\b',
      '\\bGRANT\\s+', '\\bREVOKE\\s+'
    ];
    const regProhibidas = new RegExp(declaracionesProhibidas.join('|'));
    if (regProhibidas.test(nuevoValor)) return false;

    // 3. Detectar XSS (Etiquetas HTML/Scripts)
    const regexXSS = /<\/?\w+((\s+\w+(\s*=\s*(?:".*?"|'.*?'|[^'">\s]+))?)+\s*|\s*)\/?>/i;
    if (regexXSS.test(valor)) return false;

    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    return `El campo '${args.property}' contiene caracteres o patrones no seguros (WAF Detectado).`;
  }
}

/**
 * Decorador de conveniencia para aplicar IsSqlXssSafe directamente en DTOs
 * @example
 * ```ts
 * @IsSafeText({ message: 'Texto no seguro detectado' })
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
      validator: IsSqlXssSafe,
    });
  };
}