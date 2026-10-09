import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { eq, or, isNotNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { usuarios } from '../../common/database/schema/users.schema';
import { PiiCipherService } from '../../common/security/pii-cipher';

const LARGO_MINIMO = 255;

/**
 * Deja la base lista para el cifrado de datos personales, sin pasos manuales al desplegar:
 *  1. amplía las columnas dni y telefono si todavía son cortas (migración 08, idempotente);
 *  2. cifra el DNI y el teléfono que sigan en texto plano (los ya cifrados no se tocan).
 * Corre una vez al arrancar y nunca impide el arranque: si falla, deja el aviso en el log y la API sigue
 * (los valores en texto plano se siguen leyendo; lo nuevo se cifra al guardar).
 */
@Injectable()
export class PiiMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PiiMigrationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly pii: PiiCipherService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.ampliarColumnas();
      await this.cifrarPendientes();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`No se pudo preparar el cifrado de datos personales: ${err.message}`);
    }
  }

  private async ampliarColumnas(): Promise<void> {
    const filas = await this.db.execute<{ column_name: string; character_maximum_length: number | null }>(sql`
      SELECT column_name, character_maximum_length
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name IN ('dni', 'telefono')`);
    const cortas = [...filas].filter((f) => (f.character_maximum_length ?? LARGO_MINIMO) < LARGO_MINIMO);
    if (cortas.length === 0) return;
    await this.db.execute(sql`ALTER TABLE usuarios ALTER COLUMN dni TYPE VARCHAR(255), ALTER COLUMN telefono TYPE VARCHAR(255)`);
    this.logger.log('Columnas dni y telefono ampliadas a 255 caracteres para guardar datos cifrados.');
  }

  private async cifrarPendientes(): Promise<void> {
    const filas = await this.db
      .select({ id: usuarios.id_usuario, dni: usuarios.dni, telefono: usuarios.telefono })
      .from(usuarios)
      .where(or(isNotNull(usuarios.dni), isNotNull(usuarios.telefono)));

    let cifradas = 0;
    for (const f of filas) {
      const pendiente = (v: string | null) => Boolean(v) && !v!.startsWith('enc1:');
      if (!pendiente(f.dni) && !pendiente(f.telefono)) continue;
      await this.db
        .update(usuarios)
        .set({
          dni: pendiente(f.dni) ? this.pii.cifrar(f.dni) : f.dni,
          telefono: pendiente(f.telefono) ? this.pii.cifrar(f.telefono) : f.telefono,
        })
        .where(eq(usuarios.id_usuario, f.id));
      cifradas++;
    }
    if (cifradas > 0) this.logger.log(`Datos personales cifrados: ${cifradas} usuario(s).`);
  }
}
