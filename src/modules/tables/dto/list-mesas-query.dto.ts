import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ListMesasQueryDto {
  @IsOptional()
  @IsIn(['libre', 'ocupada', 'por_cobrar', 'por_limpiar'], {
    message: 'El estado debe ser: libre, ocupada, por_cobrar o por_limpiar.',
  })
  estado?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  area?: string;
}
