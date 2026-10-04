export class DateUtils {
  /**
   * Retorna la fecha y hora actual en formato estándar YYYY-MM-DD HH:mm:ss (24h)
   * Ejemplo: '2026-08-01 11:08:12'
   */
  static formatearFechaHora(fecha: Date = new Date()): string {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    const horas = String(fecha.getHours()).padStart(2, '0');
    const minutos = String(fecha.getMinutes()).padStart(2, '0');
    const segundos = String(fecha.getSeconds()).padStart(2, '0');

    return `${anio}-${mes}-${dia} ${horas}:${minutos}:${segundos}`;
  }

  /**
   * Retorna solo la fecha en formato YYYY-MM-DD
   * Ejemplo: '2026-08-01'
   */
  static formatearSoloFecha(fecha: Date = new Date()): string {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');

    return `${anio}-${mes}-${dia}`;
  }

  /**
   * Retorna solo la hora en formato HH:mm:ss (24h)
   * Ejemplo: '11:08:12'
   */
  static formatearSoloHora(fecha: Date = new Date()): string {
    const horas = String(fecha.getHours()).padStart(2, '0');
    const minutos = String(fecha.getMinutes()).padStart(2, '0');
    const segundos = String(fecha.getSeconds()).padStart(2, '0');

    return `${horas}:${minutos}:${segundos}`;
  }

  /**
   * Inicio del día (00:00:00) para filtros de turnos o reportes
   */
  static inicioDelDia(fecha: Date = new Date()): Date {
    const d = new Date(fecha);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Fin del día (23:59:59.999)
   */
  static finDelDia(fecha: Date = new Date()): Date {
    const d = new Date(fecha);
    d.setHours(23, 59, 59, 999);
    return d;
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
   * Valida si una fecha ya expiró
   */
  static haExpirado(fechaExpiracion: Date): boolean {
    return new Date() > new Date(fechaExpiracion);
  }
}