import { registerDecorator, ValidationOptions } from 'class-validator';

// Hasta 8 enteros y 2 decimales, sin signo, sin notación científica ("12", "12.5", "12.50").
const FORMATO_DINERO = /^\d{1,8}(\.\d{1,2})?$/;
// Variación de precio: signo opcional, hasta 4 enteros y 2 decimales ("2", "-1.50", "0.00").
const FORMATO_VARIACION = /^-?\d{1,4}(\.\d{1,2})?$/;

/** Convierte "12.5" a 1250 y "-1.50" a -150 (céntimos enteros). Evita errores de coma flotante al operar con dinero. */
export function aCentimos(valor: string | number): number {
  const texto = String(valor).trim();
  const negativo = texto.startsWith('-');
  const [enteros, decimales = ''] = (negativo ? texto.slice(1) : texto).split('.');
  const centimos = Number(enteros) * 100 + Number((decimales + '00').slice(0, 2));
  return negativo ? -centimos : centimos;
}

/** Convierte 1250 céntimos a "12.50". */
export function desdeCentimos(centimos: number): string {
  const signo = centimos < 0 ? '-' : '';
  const abs = Math.abs(Math.round(centimos));
  return `${signo}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Valida un monto como texto decimal NO negativo con máximo 2 decimales (p. ej. "150.00").
 * Con `{ positivo: true }` además exige que sea mayor que cero.
 * Rechaza negativos, signos, exponentes ("1e9"), espacios y más de 2 decimales.
 */
export function IsMoney(opciones: { positivo?: boolean } = {}, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isMoney',
      target: object.constructor,
      propertyName,
      options: {
        message: opciones.positivo
          ? 'El monto debe ser mayor a cero, con hasta 2 decimales (ej: "12.50").'
          : 'El monto debe ser un valor no negativo con hasta 2 decimales (ej: "12.50").',
        ...validationOptions,
      },
      validator: {
        validate(valor: unknown) {
          if (typeof valor !== 'string' || !FORMATO_DINERO.test(valor)) return false;
          return opciones.positivo ? aCentimos(valor) > 0 : true;
        },
      },
    });
  };
}

/**
 * Variación de precio con signo (p. ej. "+2.00" de leche de avena, "-1.00" de un tamaño pequeño):
 * hasta 4 enteros y 2 decimales, sin exponentes. El "+" explícito no se admite; el 0 sí.
 */
export function IsPriceDelta(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isPriceDelta',
      target: object.constructor,
      propertyName,
      options: {
        message: 'La variación de precio debe ser un monto con hasta 2 decimales, positivo, negativo o cero (ej: "2.00", "-1.50").',
        ...validationOptions,
      },
      validator: {
        validate: (valor: unknown) => typeof valor === 'string' && FORMATO_VARIACION.test(valor),
      },
    });
  };
}
