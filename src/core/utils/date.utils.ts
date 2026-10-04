export class DateUtils {
  private static readonly TIMEZONE = 'America/Lima';

  /**
   * Retorna la fecha y hora actual como objeto Date
   */
  static ahoraUtc(): Date {
    return new Date();
  }

  /**
   * Retorna la fecha y hora formateada en hora oficial de Lima/Perú: YYYY-MM-DD HH:mm:ss (24h)
   * Ejemplo: '2026-08-01 11:08:12'
   */
  static formatearFechaHora(fecha: Date = new Date()): string {
    const formateador = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    // en-CA genera formato estándar YYYY-MM-DD, hh:mm:ss
    return formateador.format(fecha).replace(',', '');
  }

  /**
   * Retorna solo la fecha en Lima/Perú: YYYY-MM-DD
   * Ejemplo: '2026-08-01'
   */
  static formatearSoloFecha(fecha: Date = new Date()): string {
    const formateador = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    return formateador.format(fecha);
  }

  /**
   * Retorna solo la hora en Lima/Perú: HH:mm:ss (24h)
   * Ejemplo: '11:08:12'
   */
  static formatearSoloHora(fecha: Date = new Date()): string {
    const formateador = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    return formateador.format(fecha);
  }

  /**
   * Retorna el inicio del día en Lima/Perú (00:00:00.000)
   */
  static inicioDelDia(fecha: Date = new Date()): Date {
    const d = new Date(fecha);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Retorna el fin del día en Lima/Perú (23:59:59.999)
   */
  static finDelDia(fecha: Date = new Date()): Date {
    const d = new Date(fecha);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  /**
   * Diferencia en minutos entre dos fechas
   */
  static diferenciaEnMinutos(fechaInicio: Date, fechaFin: Date = new Date()): number {
    const diffMs = Math.abs(fechaFin.getTime() - fechaInicio.getTime());
    return Math.floor(diffMs / (1000 * 60));
  }

  /**
   * Valida si una fecha ya expiró
   */
  static haExpirado(fechaExpiracion: Date): boolean {
    return new Date() > new Date(fechaExpiracion);
  }

  /**
   * Suma minutos a una fecha base (TTL de OTPs y tokens)
   */
  static sumarMinutos(minutos: number, fechaBase: Date = new Date()): Date {
    const fecha = new Date(fechaBase);
    fecha.setMinutes(fecha.getMinutes() + minutos);
    return fecha;
  }

  /**
   * Alias de formato de fecha YYYY-MM-DD
   */
  static aFormatoFecha(fecha: Date): string {
    return this.formatearSoloFecha(fecha);
  }
}