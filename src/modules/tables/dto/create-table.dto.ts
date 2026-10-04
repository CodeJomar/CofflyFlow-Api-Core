import { IsNotEmpty, IsString, MaxLength, IsOptional, IsInt, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

export class CreateTableDto {
  @IsNotEmpty({ message: 'El número o identificador de mesa es obligatorio (ej: "M-01", "BARRA-1").' })
  @IsString({ message: 'El identificador debe ser una cadena de texto.' })
  @MaxLength(10, { message: 'El identificador no puede exceder los 10 caracteres.' })
  @IsSafeText()
  numero: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La capacidad debe ser un número entero.' })
  @Min(1, { message: 'La capacidad mínima debe ser de al menos 1 persona.' })
  capacidad?: number = 2;

  @IsOptional()
  @IsIn(['libre', 'ocupada', 'por_cobrar'], {
    message: 'El estado inicial debe ser libre, ocupada o por_cobrar.',
  })
  estado?: string = 'libre';
}