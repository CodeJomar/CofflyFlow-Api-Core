/**
 * Cifra (de forma idempotente) el DNI y el teléfono que sigan en texto plano en la tabla usuarios.
 * Uso:  npm run seed:cifrar-pii        (con DATABASE_URL, JWT_SECRET y, si se usa, PII_ENCRYPTION_KEY de la API)
 * Antes hay que aplicar database/database-migracion-08-cifrado-pii.sql. Los valores ya cifrados no se tocan.
 * IMPORTANTE: debe usar la MISMA clave que la API; con otra clave los datos no se podrían leer.
 */
import postgres from 'postgres';
import { cifrarPii, derivarClavePii, estaCifrado } from '../common/security/pii-cipher';

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Sin .env: se usan las variables ya presentes en el entorno.
  }
  const { DATABASE_URL, DB_SSL, PII_ENCRYPTION_KEY, JWT_SECRET } = process.env;
  if (!DATABASE_URL) throw new Error('Falta DATABASE_URL.');
  const clave = derivarClavePii(PII_ENCRYPTION_KEY, JWT_SECRET);

  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, ssl: DB_SSL === 'true' ? 'require' : false });
  try {
    const filas = await sql<{ id_usuario: string; dni: string | null; telefono: string | null }[]>`
      SELECT id_usuario, dni, telefono FROM usuarios WHERE dni IS NOT NULL OR telefono IS NOT NULL`;
    let cifradas = 0;
    await sql.begin(async (tx) => {
      for (const f of filas) {
        const dni = f.dni && !estaCifrado(f.dni) ? cifrarPii(f.dni, clave) : f.dni;
        const telefono = f.telefono && !estaCifrado(f.telefono) ? cifrarPii(f.telefono, clave) : f.telefono;
        if (dni === f.dni && telefono === f.telefono) continue;
        await tx`UPDATE usuarios SET dni = ${dni}, telefono = ${telefono} WHERE id_usuario = ${f.id_usuario}`;
        cifradas++;
      }
    });
    console.log(`Datos personales cifrados: ${cifradas} de ${filas.length} usuario(s) con DNI o teléfono.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
