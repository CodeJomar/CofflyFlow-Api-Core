/**
 * Crea el primer usuario OWNER (el sistema no tiene registro público).
 * Uso:  OWNER_EMAIL=... OWNER_NAME=... OWNER_PASSWORD=... npm run seed:owner
 * (las variables también pueden estar en .env). Falla si el correo ya existe.
 */
import * as bcrypt from 'bcrypt';
import postgres from 'postgres';

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Sin .env: se usan las variables ya presentes en el entorno.
  }

  const { DATABASE_URL, DB_SSL, OWNER_EMAIL, OWNER_NAME, OWNER_PASSWORD, BCRYPT_SALT_ROUNDS } = process.env;
  if (!DATABASE_URL || !OWNER_EMAIL || !OWNER_NAME || !OWNER_PASSWORD) {
    throw new Error('Faltan variables: DATABASE_URL, OWNER_EMAIL, OWNER_NAME y OWNER_PASSWORD.');
  }
  if (OWNER_PASSWORD.length < 8 || !/(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9])/.test(OWNER_PASSWORD)) {
    throw new Error('OWNER_PASSWORD debe tener al menos 8 caracteres e incluir letras, números y un símbolo.');
  }

  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, ssl: DB_SSL === 'true' ? 'require' : false });
  try {
    const email = OWNER_EMAIL.toLowerCase().trim();
    const existente = await sql`SELECT 1 FROM usuarios WHERE email = ${email} AND eliminado = FALSE LIMIT 1`;
    if (existente.length > 0) {
      throw new Error('Ya existe un usuario con ese correo.');
    }

    const hash = await bcrypt.hash(OWNER_PASSWORD, Number(BCRYPT_SALT_ROUNDS) || 12);
    await sql`
      INSERT INTO usuarios (tipo_cuenta, id_rol, email, password_hash, nombre, estado, email_verificado, email_verificado_el)
      VALUES ('OWNER', NULL, ${email}, ${hash}, ${OWNER_NAME.trim()}, 'activo', TRUE, now())
    `;
    console.log(`Cuenta OWNER creada para ${email}.`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
