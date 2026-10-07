import { BadRequestException } from '@nestjs/common';

const CLAVE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Valida la cabecera Idempotency-Key. En operaciones con dinero (cobros, devoluciones) es OBLIGATORIA: un doble clic
 * o un reintento de red no debe cobrar ni devolver dos veces. El cliente genera una clave por intento y la reutiliza
 * si reintenta.
 */
export function validarClaveIdempotencia(clave: string | undefined, obligatoria: boolean): string | undefined {
  if (clave === undefined || clave === '') {
    if (obligatoria) throw new BadRequestException('Falta la cabecera Idempotency-Key (8 a 64 caracteres) en esta operación.');
    return undefined;
  }
  if (!CLAVE.test(clave)) {
    throw new BadRequestException('Idempotency-Key debe tener entre 8 y 64 caracteres (letras, números, "-" o "_").');
  }
  return clave;
}
