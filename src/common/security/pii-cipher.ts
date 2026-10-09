import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Cifrado reversible de datos personales (DNI y teléfono del personal) con AES-256-GCM.
 * Las contraseñas NO usan esto: van con bcrypt (hash de un solo sentido). Aquí hace falta recuperar el dato original.
 * Formato guardado: "enc1:" + base64url(iv de 12 bytes | etiqueta de autenticación de 16 | texto cifrado).
 * GCM autentica: si alguien altera el valor en la base, el descifrado falla en vez de devolver basura.
 * Un valor sin el prefijo "enc1:" se trata como texto plano heredado (datos anteriores al cifrado) y se devuelve igual.
 */
const PREFIJO = 'enc1:';

/** Clave de 32 bytes: PII_ENCRYPTION_KEY (hex de 64 caracteres o cualquier frase) o, si falta, derivada de JWT_SECRET. */
export function derivarClavePii(piiKey: string | undefined, jwtSecret: string | undefined): Buffer {
  const clave = piiKey?.trim();
  if (clave) return /^[0-9a-f]{64}$/i.test(clave) ? Buffer.from(clave, 'hex') : createHash('sha256').update(clave).digest();
  if (!jwtSecret?.trim()) throw new Error('Falta PII_ENCRYPTION_KEY (o JWT_SECRET) para cifrar los datos personales.');
  return Buffer.from(hkdfSync('sha256', jwtSecret, 'coffyflow-pii', 'aes-256-gcm', 32));
}

export function cifrarPii(texto: string, clave: Buffer): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv('aes-256-gcm', clave, iv);
  const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  return PREFIJO + Buffer.concat([iv, cifrador.getAuthTag(), cifrado]).toString('base64url');
}

export function estaCifrado(valor: string): boolean {
  return valor.startsWith(PREFIJO);
}

export function descifrarPii(valor: string, clave: Buffer): string {
  if (!estaCifrado(valor)) return valor;
  const datos = Buffer.from(valor.slice(PREFIJO.length), 'base64url');
  const descifrador = createDecipheriv('aes-256-gcm', clave, datos.subarray(0, 12));
  descifrador.setAuthTag(datos.subarray(12, 28));
  return Buffer.concat([descifrador.update(datos.subarray(28)), descifrador.final()]).toString('utf8');
}

@Injectable()
export class PiiCipherService {
  private readonly clave: Buffer;

  constructor(config: ConfigService) {
    this.clave = derivarClavePii(config.get<string>('PII_ENCRYPTION_KEY'), config.get<string>('JWT_SECRET'));
  }

  /** Cifra un dato; null y vacío se guardan como null. */
  cifrar(valor: string | null | undefined): string | null {
    const limpio = valor?.trim();
    return limpio ? cifrarPii(limpio, this.clave) : null;
  }

  /** Descifra un dato guardado; tolera texto plano heredado y nunca revienta la lectura si el valor está dañado. */
  descifrar(valor: string | null | undefined): string | null {
    if (!valor) return null;
    try {
      return descifrarPii(valor, this.clave);
    } catch {
      return null;
    }
  }
}
