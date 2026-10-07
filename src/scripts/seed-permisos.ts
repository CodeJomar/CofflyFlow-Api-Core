/**
 * Carga (de forma idempotente) los módulos, acciones y la matriz inicial de permisos por cargo.
 * Uso:  npm run seed:permisos
 * Solo AGREGA lo que falta; no borra ni modifica permisos existentes. Requiere que existan los cargos
 * (WAITER, BARISTA, CASHIER, OPERATOR); ver database/database-migracion-01-auth.sql.
 */
import postgres from 'postgres';
import { ACCION, MODULO, PERMISOS_POR_CARGO } from '../common/security/permission-matrix';

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Sin .env: se usan las variables ya presentes en el entorno.
  }
  const { DATABASE_URL, DB_SSL } = process.env;
  if (!DATABASE_URL) throw new Error('Falta DATABASE_URL.');

  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, ssl: DB_SSL === 'true' ? 'require' : false });
  try {
    await sql.begin(async (tx) => {
      for (const nombre of Object.values(MODULO)) {
        await tx`INSERT INTO modulos (nombre) SELECT ${nombre}::varchar WHERE NOT EXISTS (SELECT 1 FROM modulos WHERE nombre = ${nombre} AND eliminado = FALSE)`;
      }
      for (const nombre of Object.values(ACCION)) {
        await tx`INSERT INTO acciones (nombre) SELECT ${nombre}::varchar WHERE NOT EXISTS (SELECT 1 FROM acciones WHERE nombre = ${nombre} AND eliminado = FALSE)`;
      }

      let nuevos = 0;
      for (const [cargo, permisos] of Object.entries(PERMISOS_POR_CARGO)) {
        const [rol] = await tx`SELECT id_rol FROM roles WHERE nombre = ${cargo} AND eliminado = FALSE LIMIT 1`;
        if (!rol) throw new Error(`No existe el cargo ${cargo}. Aplica primero database/database-migracion-01-auth.sql.`);

        for (const [modulo, accion] of permisos) {
          const insertados = await tx`
            INSERT INTO rol_permisos (id_rol, id_modulo, id_accion)
            SELECT ${rol.id_rol}, m.id_modulo, a.id_accion
              FROM modulos m, acciones a
             WHERE m.nombre = ${modulo} AND m.eliminado = FALSE
               AND a.nombre = ${accion} AND a.eliminado = FALSE
               AND NOT EXISTS (
                 SELECT 1 FROM rol_permisos rp
                  WHERE rp.id_rol = ${rol.id_rol} AND rp.id_modulo = m.id_modulo
                    AND rp.id_accion = a.id_accion AND rp.eliminado = FALSE)
            RETURNING id_rol_permiso`;
          nuevos += insertados.length;
        }
      }
      console.log(`Matriz de permisos lista: ${nuevos} permiso(s) nuevo(s) agregado(s).`);
    });
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
