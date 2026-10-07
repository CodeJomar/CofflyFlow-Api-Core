import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/shared-store/redis.provider';

interface RegistroIntentos {
  fallos: number;
  ultimoFallo: number;
  bloqueadoHasta: number;
}

export interface ResultadoFallo {
  intentosRestantes: number;
  bloqueadoSegundos: number;
}

const VENTANA_FALLOS_MS = 15 * 60_000;
const MAX_REGISTROS = 10_000;

// Cuenta el fallo y, al llegar al máximo, abre el bloqueo y reinicia el contador, todo en una operación atómica.
// KEYS[1] contador, KEYS[2] bloqueo. ARGV: ventana_ms, max_intentos, bloqueo_ms. Devuelve {fallos, bloqueado}.
const SCRIPT_FALLO = `
local fallos = redis.call('INCR', KEYS[1])
if fallos == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if fallos >= tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return {fallos, 1}
end
return {fallos, 0}
`;

/**
 * Contador de intentos de login por correo (+ IP). Cuenta TAMBIÉN los correos que no existen, de modo que el mensaje
 * de "intentos restantes" y el bloqueo temporal son idénticos exista o no la cuenta (AUTH-008). El estado vive en
 * Redis cuando hay REDIS_URL (común a todas las instancias; las claves se guardan hasheadas, sin correos en claro).
 * Sin Redis, o si cae, se usa memoria local. El bloqueo persistente de cuentas reales sigue en la base de datos
 * (usuarios.intentos_fallidos / bloqueado_hasta).
 */
@Injectable()
export class LoginAttemptsService {
  private readonly registros = new Map<string, RegistroIntentos>();
  readonly maxIntentos: number;
  private readonly bloqueoMs: number;

  constructor(
    config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {
    this.maxIntentos = Number(config.get('MAX_LOGIN_ATTEMPTS')) || 5;
    this.bloqueoMs = (Number(config.get('ACCOUNT_LOCKOUT_MINUTES')) || 1) * 60_000;
  }

  private claveRedis(clave: string, tipo: 'c' | 'b'): string {
    return `la:${tipo}:${createHash('sha256').update(clave).digest('hex')}`;
  }

  /** Segundos que faltan para poder reintentar; 0 si no hay bloqueo vigente. */
  async segundosBloqueo(clave: string): Promise<number> {
    if (this.redis) {
      try {
        const ms = await this.redis.pttl(this.claveRedis(clave, 'b'));
        return ms > 0 ? Math.ceil(ms / 1000) : 0;
      } catch {
        // Redis caído: se consulta la memoria local.
      }
    }
    return this.segundosBloqueoLocal(clave);
  }

  async registrarFallo(clave: string): Promise<ResultadoFallo> {
    if (this.redis) {
      try {
        const [fallos, bloqueado] = (await this.redis.eval(
          SCRIPT_FALLO,
          2,
          this.claveRedis(clave, 'c'),
          this.claveRedis(clave, 'b'),
          VENTANA_FALLOS_MS,
          this.maxIntentos,
          this.bloqueoMs,
        )) as [number, number];
        return bloqueado === 1
          ? { intentosRestantes: 0, bloqueadoSegundos: Math.ceil(this.bloqueoMs / 1000) }
          : { intentosRestantes: this.maxIntentos - fallos, bloqueadoSegundos: 0 };
      } catch {
        // Redis caído: se cuenta en memoria local.
      }
    }
    return this.registrarFalloLocal(clave);
  }

  async limpiar(clave: string): Promise<void> {
    this.registros.delete(clave);
    if (!this.redis) return;
    try {
      await this.redis.del(this.claveRedis(clave, 'c'), this.claveRedis(clave, 'b'));
    } catch {
      // Sin Redis no hay nada más que limpiar.
    }
  }

  // ---- Memoria local (desarrollo, una instancia o Redis caído) ----

  private segundosBloqueoLocal(clave: string): number {
    const registro = this.registros.get(clave);
    if (!registro) return 0;
    const restante = registro.bloqueadoHasta - Date.now();
    if (restante > 0) return Math.ceil(restante / 1000);
    if (Date.now() - registro.ultimoFallo > VENTANA_FALLOS_MS || registro.bloqueadoHasta > 0) {
      this.registros.delete(clave);
    }
    return 0;
  }

  private registrarFalloLocal(clave: string): ResultadoFallo {
    this.purgar();
    const ahora = Date.now();
    const previo = this.registros.get(clave);
    const vigente = previo && ahora - previo.ultimoFallo <= VENTANA_FALLOS_MS ? previo : undefined;
    const fallos = (vigente?.fallos ?? 0) + 1;

    if (fallos >= this.maxIntentos) {
      this.registros.set(clave, { fallos, ultimoFallo: ahora, bloqueadoHasta: ahora + this.bloqueoMs });
      return { intentosRestantes: 0, bloqueadoSegundos: Math.ceil(this.bloqueoMs / 1000) };
    }

    this.registros.set(clave, { fallos, ultimoFallo: ahora, bloqueadoHasta: 0 });
    return { intentosRestantes: this.maxIntentos - fallos, bloqueadoSegundos: 0 };
  }

  private purgar(): void {
    if (this.registros.size < MAX_REGISTROS) return;
    const ahora = Date.now();
    for (const [clave, registro] of this.registros) {
      if (registro.bloqueadoHasta < ahora && ahora - registro.ultimoFallo > VENTANA_FALLOS_MS) {
        this.registros.delete(clave);
      }
    }
  }
}
