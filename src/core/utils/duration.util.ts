const UNIDADES_SEGUNDOS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/**
 * Convierte una duración tipo '15m', '7d', '30s' o '2h' a segundos.
 * Un número sin unidad se interpreta como segundos.
 */
export function duracionASegundos(valor: string | undefined, porDefecto: number): number {
  if (!valor) return porDefecto;
  const coincidencia = /^(\d+)\s*([smhd])?$/i.exec(valor.trim());
  if (!coincidencia) return porDefecto;
  const unidad = (coincidencia[2] ?? 's').toLowerCase();
  return Number(coincidencia[1]) * UNIDADES_SEGUNDOS[unidad];
}
