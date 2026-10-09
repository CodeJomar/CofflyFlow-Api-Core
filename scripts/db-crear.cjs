// Crea el esquema completo de la base de datos ejecutando database/database.sql (partes 1 a 11).
// Uso (una sola vez, sobre una base VACÍA):
//   PowerShell:  $env:DATABASE_URL="<dirección de la base>"; $env:DB_SSL="true"; npm run db:crear
//   Bash:        DATABASE_URL="<dirección de la base>" DB_SSL=true npm run db:crear
// - DATABASE_URL: dirección de la base. Desde tu PC en Railway usa la dirección PÚBLICA del servicio PostgreSQL.
// - DB_SSL: "true" para conexiones públicas; "false" solo dentro de la red privada de Railway.
// El archivo se ejecuta como una sola transacción: si algo falla, no queda nada creado a medias.
// Si la base ya tiene tablas del sistema, el script se detiene sin tocar nada.
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL. Defínela en la terminal antes de ejecutar este script (no la guardes en archivos).');
  process.exit(1);
}

const archivo = path.join(__dirname, '..', 'database', 'database.sql');
const sql = postgres(url, { max: 1, prepare: false, ssl: process.env.DB_SSL === 'true' ? 'require' : false, onnotice: () => {} });

(async () => {
  try {
    const [{ existe }] = await sql`SELECT to_regclass('public.usuarios') IS NOT NULL AS existe`;
    if (existe) {
      console.error('La base ya tiene el esquema (existe la tabla usuarios). No se ejecutó nada.');
      process.exitCode = 1;
      return;
    }

    console.log('Aplicando database/database.sql …');
    await sql.unsafe(fs.readFileSync(archivo, 'utf8'));

    const [{ tablas }] = await sql`SELECT count(*)::int AS tablas FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    const [{ indices }] = await sql`SELECT count(*)::int AS indices FROM pg_indexes WHERE schemaname = 'public'`;
    console.log(`Esquema creado: ${tablas} tablas y ${indices} índices.`);
    console.log('Siguiente paso: npm run seed:permisos y luego npm run seed:owner (con la misma DATABASE_URL).');
  } catch (e) {
    console.error('ERROR al crear el esquema (la transacción se revirtió):', e.message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
