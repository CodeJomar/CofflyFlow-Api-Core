import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** Orden deseado: los ids en la posición en que deben mostrarse (el primero se muestra primero). */
export class ReordenarDto {
  @IsArray({ message: 'ids debe ser una lista.' })
  @ArrayMinSize(1, { message: 'Indica al menos un elemento.' })
  @ArrayMaxSize(200, { message: 'Demasiados elementos en una sola petición.' })
  @ArrayUnique({ message: 'No repitas elementos.' })
  @IsUUID('4', { each: true, message: 'Cada id debe ser un UUID válido.' })
  ids: string[];
}
