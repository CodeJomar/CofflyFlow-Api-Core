import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

/** Un permiso del catálogo: módulo + acción (p. ej. MENU + CREAR). Solo se aceptan los que existen en el catálogo. */
export class PermisoDto {
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z_]+$/, { message: 'El módulo debe estar en mayúsculas (ej: MENU).' })
  modulo: string;

  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Z_]+$/, { message: 'La acción debe estar en mayúsculas (ej: CREAR).' })
  accion: string;
}

export class CreateRolDto {
  @IsNotEmpty({ message: 'El nombre del rol es obligatorio.' })
  @IsString()
  @MinLength(2, { message: 'El nombre del rol debe tener al menos 2 caracteres.' })
  @MaxLength(50, { message: 'El nombre del rol no puede exceder los 50 caracteres.' })
  @IsSafeText()
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @IsSafeText()
  descripcion?: string;

  /** Permisos iniciales del rol (se pueden cambiar después con PUT /roles/:id/permisos). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200, { message: 'Demasiados permisos en una sola petición.' })
  @ValidateNested({ each: true })
  @Type(() => PermisoDto)
  permisos?: PermisoDto[];
}

export class UpdateRolDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @IsSafeText()
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @IsSafeText()
  descripcion?: string;
}

export class ReemplazarPermisosDto {
  /** Conjunto COMPLETO de permisos del rol: reemplaza al anterior. Una lista vacía deja el rol sin permisos. */
  @IsArray()
  @ArrayMaxSize(200, { message: 'Demasiados permisos en una sola petición.' })
  @ValidateNested({ each: true })
  @Type(() => PermisoDto)
  permisos: PermisoDto[];
}
