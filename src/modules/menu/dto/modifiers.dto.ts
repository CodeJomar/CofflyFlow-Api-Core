import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';
import { IsPriceDelta } from '../../../common/validators/money.validator';

// ---- Opciones (p. ej. "Avena +2.00") ----------------------------------------------------------------------------

export class CreateOpcionDto {
  @IsNotEmpty({ message: 'El nombre de la opción es obligatorio.' })
  @IsString()
  @MaxLength(60, { message: 'El nombre de la opción no puede exceder los 60 caracteres.' })
  @IsSafeText()
  nombre: string;

  /** Variación sobre el precio base del producto; puede ser negativa o cero. */
  @IsOptional()
  @IsPriceDelta()
  price_delta?: string;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  orden_visual?: number;
}

export class UpdateOpcionDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @IsSafeText()
  nombre?: string;

  @IsOptional()
  @IsPriceDelta()
  price_delta?: string;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  orden_visual?: number;
}

export class ToggleOpcionDto {
  @IsOptional()
  @IsBoolean({ message: 'El campo disponible debe ser booleano.' })
  disponible?: boolean;
}

// ---- Grupos (p. ej. "Tipo de leche") ------------------------------------------------------------------------------

export class CreateGrupoDto {
  @IsNotEmpty({ message: 'El nombre del grupo es obligatorio.' })
  @IsString()
  @MaxLength(60, { message: 'El nombre del grupo no puede exceder los 60 caracteres.' })
  @IsSafeText()
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @IsSafeText()
  descripcion?: string;

  /** 0 = opcional; 1 o más = obligatorio (el cliente debe elegir al menos esa cantidad). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La selección mínima debe ser un entero.' })
  @Min(0)
  @Max(20)
  seleccion_minima?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La selección máxima debe ser un entero.' })
  @Min(1)
  @Max(20)
  seleccion_maxima?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  orden_visual?: number;

  /** Opciones iniciales (se pueden agregar más después). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50, { message: 'Un grupo admite como máximo 50 opciones.' })
  @ValidateNested({ each: true })
  @Type(() => CreateOpcionDto)
  opciones?: CreateOpcionDto[];
}

export class UpdateGrupoDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @IsSafeText()
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @IsSafeText()
  descripcion?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  seleccion_minima?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  seleccion_maxima?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  orden_visual?: number;
}

// ---- Asignación de grupos a un producto ---------------------------------------------------------------------------

export class AsignacionGrupoDto {
  @IsUUID('4', { message: 'El id_grupo debe ser un UUID válido.' })
  id_grupo: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  orden_visual?: number;
}

export class AsignarGruposDto {
  /** Conjunto COMPLETO de grupos del producto: reemplaza al anterior. Una lista vacía los quita todos. */
  @IsArray()
  @ArrayMaxSize(20, { message: 'Un producto admite como máximo 20 grupos de modificadores.' })
  @ValidateNested({ each: true })
  @Type(() => AsignacionGrupoDto)
  grupos: AsignacionGrupoDto[];
}
