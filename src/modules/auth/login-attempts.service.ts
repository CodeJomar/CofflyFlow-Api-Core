import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

/**
 * Contador de intentos de login por correo. Cuenta TAMBIÉN los correos que no existen, de modo que
 * el mensaje de "intentos restantes" y el bloqueo temporal son idénticos exista o no la cuenta
 * (AUTH-008). Vive en memoria: es un freno de fuerza bruta; el bloqueo persistente de cuentas reales
 * sigue en la base de datos (usuarios.intentos_fallidos / bloqueado_hasta).
 */
@Injectable()
export class LoginAttemptsService {
  private readonly registros = new Map<string, RegistroIntentos>();
  readonly maxIntentos: number;
  private readonly bloqueoMs: number;

  constructor(config: ConfigService) {
    this.maxIntentos = Number(config.get('MAX_LOGIN_ATTEMPTS')) || 5;
    this.bloqueoMs = (Number(config.get('ACCOUNT_LOCKOUT_MINUTES')) || 1) * 60_000;
  }

  /** Segundos que faltan para poder reintentar; 0 si no hay bloqueo vigente. */
  segundosBloqueo(clave: string): number {
    const registro = this.registros.get(clave);
    if (!registro) return 0;
    const restante = registro.bloqueadoHasta - Date.now();
    if (restante > 0) return Math.ceil(restante / 1000);
    if (Date.now() - registro.ultimoFallo > VENTANA_FALLOS_MS || registro.bloqueadoHasta > 0) {
      this.registros.delete(clave);
    }
    return 0;
  }

  registrarFallo(clave: string): ResultadoFallo {
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

  limpiar(clave: string): void {
    this.registros.delete(clave);
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
