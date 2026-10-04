import { IsOptional, IsDateString, IsUUID } from 'class-validator';

export class DashboardFiltroDto {
  @IsOptional()
  @IsDateString({}, { message: 'fecha_inicio debe tener formato ISO 8601 (ej: 2026-10-04).' })
  fecha_inicio?: string;

  @IsOptional()
  @IsDateString({}, { message: 'fecha_fin debe tener formato ISO 8601 (ej: 2026-10-04).' })
  fecha_fin?: string;

  @IsOptional()
  @IsUUID('4', { message: 'id_turno_caja debe ser un UUID válido.' })
  id_turno_caja?: string;
}