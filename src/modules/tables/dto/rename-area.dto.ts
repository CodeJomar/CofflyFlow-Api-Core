import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsSafeText } from '../../../common/validators/is-sql-xss-safe.validator';

/** Renombra un área del local en todas sus mesas a la vez. */
export class RenameAreaDto {
  @IsNotEmpty({ message: 'Indica el nombre actual del área.' })
  @IsString()
  @MaxLength(30, { message: 'El área no puede exceder los 30 caracteres.' })
  actual: string;

  @IsNotEmpty({ message: 'Indica el nuevo nombre del área.' })
  @IsString()
  @MaxLength(30, { message: 'El área no puede exceder los 30 caracteres.' })
  @IsSafeText()
  nuevo: string;
}
