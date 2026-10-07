import { IsOptional, IsUUID, Matches } from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Período del dashboard. Tres modos, de menor a mayor prioridad:
 *  - sin filtros: el día de hoy (hora de Lima);
 *  - fecha_inicio + fecha_fin (ambas, YYYY-MM-DD, máximo 366 días);
 *  - id_turno_caja: todo el turno indicado.
 */
export class DashboardFiltroDto {
  @IsOptional()
  @Matches(FECHA, { message: 'fecha_inicio debe tener formato YYYY-MM-DD (ej: 2026-10-04).' })
  fecha_inicio?: string;

  @IsOptional()
  @Matches(FECHA, { message: 'fecha_fin debe tener formato YYYY-MM-DD (ej: 2026-10-04).' })
  fecha_fin?: string;

  @IsOptional()
  @IsUUID('4', { message: 'id_turno_caja debe ser un UUID válido.' })
  id_turno_caja?: string;
}
