import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsMoney } from '../../../common/validators/money.validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

export class CierreTurnoDto {
  @IsNotEmpty({ message: 'El monto final real contado es obligatorio para el arqueo.' })
  @IsMoney({}, { message: 'El monto final debe ser un monto no negativo con hasta 2 decimales (ej: "450.50").' })
  monto_final_real: string;

  @IsOptional()
  @IsString({ message: 'Las notas de cierre deben ser texto.' })
  @MaxLength(500, { message: 'Las notas no pueden superar los 500 caracteres.' })
  @IsSafeText()
  notas_cierre?: string;

  /**
   * Conteo físico del arqueo: cantidad de billetes y monedas por denominación
   * (claves b200, b100, b50, b20, b10, m5, m2, m1, m050, m020, m010). Si se envía, su suma debe coincidir
   * con `monto_final_real`; queda guardado para auditar el cierre.
   */
  @IsOptional()
  @IsObject({ message: 'El conteo debe ser un objeto { denominacion: cantidad }.' })
  conteo?: Record<string, number>;
}