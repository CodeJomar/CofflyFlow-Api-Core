import { HttpException, HttpStatus } from '@nestjs/common';

/** 429 por bloqueo temporal de login. El filtro global expone `retry_after_segundos` y la cabecera Retry-After. */
export class TooManyAttemptsException extends HttpException {
  constructor(segundos: number) {
    const texto = segundos >= 60 ? `${Math.ceil(segundos / 60)} minuto(s)` : `${segundos} segundo(s)`;
    super(
      { message: `Demasiados intentos fallidos. Intenta de nuevo en ${texto}.`, retry_after_segundos: segundos },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
