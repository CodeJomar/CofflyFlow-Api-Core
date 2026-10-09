// Respaldo y prueba de restauración de la base de datos, usando Docker (no hace falta instalar PostgreSQL).
//
//   npm run db:respaldo            crea un respaldo en la carpeta respaldos/ (formato comprimido de pg_dump)
//   npm run db:respaldo -- probar  restaura el último respaldo en una base TEMPORAL y mide el tiempo (RTO)
//   npm run db:respaldo -- probar respaldos/archivo.dump   (con un respaldo concreto)
//
// Variables de entorno (defínelas en la terminal; no las guardes en archivos):
//   DATABASE_URL  dirección de la base (desde tu PC en Railway usa la dirección PÚBLICA del servicio PostgreSQL)
//   DB_SSL        "true" para conexiones públicas (por defecto "true"); "false" en la red privada
//   RESPALDOS_DIR carpeta donde se guardan los respaldos (por defecto respaldos/); puede ser una carpeta sincronizada con OneDrive
//   PG_IMAGEN     imagen de PostgreSQL de Docker; debe ser de versión IGUAL O MAYOR que la del servidor (por defecto postgres:18)
//
// La carpeta respaldos/ contiene datos reales: está en .gitignore y no debe subirse al repositorio.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const IMAGEN = process.env.PG_IMAGEN || 'postgres:18';
const CARPETA = process.env.RESPALDOS_DIR ? path.resolve(process.env.RESPALDOS_DIR) : path.join(__dirname, '..', 'respaldos');
const modo = process.argv[2] === 'probar' ? 'probar' : 'crear';

const docker = (args, opciones = {}) => spawnSync('docker', args, { encoding: 'utf8', ...opciones });
const falla = (mensaje) => {
  console.error(mensaje);
  process.exit(1);
};
const segundos = (inicio) => ((Date.now() - inicio) / 1000).toFixed(1);

if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) {
  falla('Docker no está en marcha. Abre Docker Desktop y vuelve a intentarlo.');
}

// ---------------------------------------------------------------- crear
function crear() {
  const url = process.env.DATABASE_URL;
  if (!url) falla('Falta DATABASE_URL (dirección pública de la base).');
  const u = new URL(url);
  fs.mkdirSync(CARPETA, { recursive: true });

  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archivo = `respaldo-${sello}.dump`;
  const inicio = Date.now();
  console.log(`Respaldando ${u.hostname}:${u.port || 5432}/${u.pathname.slice(1)} con ${IMAGEN} …`);

  const r = docker(
    [
      'run', '--rm',
      '-e', 'PGPASSWORD', '-e', 'PGSSLMODE',
      '-v', `${path.resolve(CARPETA)}:/respaldos`,
      IMAGEN,
      'pg_dump', '-Fc', '--no-owner', '--no-privileges',
      '-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username), '-d', u.pathname.slice(1),
      '-f', `/respaldos/${archivo}`,
    ],
    { env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password), PGSSLMODE: process.env.DB_SSL === 'false' ? 'prefer' : 'require' } },
  );
  if (r.status !== 0) falla(`No se pudo respaldar:\n${r.stderr || r.stdout}`);

  const kb = (fs.statSync(path.join(CARPETA, archivo)).size / 1024).toFixed(0);
  console.log(`Respaldo listo: respaldos/${archivo} (${kb} KB) en ${segundos(inicio)} s.`);
  console.log('Para comprobar que sirve: npm run db:respaldo -- probar');
}

// ---------------------------------------------------------------- probar
function probar() {
  let archivo = process.argv[3];
  if (!archivo) {
    const lista = fs.existsSync(CARPETA) ? fs.readdirSync(CARPETA).filter((f) => f.endsWith('.dump')).sort() : [];
    if (lista.length === 0) falla('No hay respaldos en respaldos/. Crea uno con: npm run db:respaldo');
    archivo = path.join(CARPETA, lista[lista.length - 1]);
  }
  if (!fs.existsSync(archivo)) falla(`No existe el archivo ${archivo}`);

  const nombre = 'pg-prueba-restauracion';
  docker(['rm', '-f', nombre]);
  const inicio = Date.now();
  console.log(`Restaurando ${path.basename(archivo)} en una base temporal (${IMAGEN}) …`);

  const arranque = docker(['run', '-d', '--name', nombre, '-e', 'POSTGRES_PASSWORD=prueba', IMAGEN]);
  if (arranque.status !== 0) falla(`No se pudo iniciar la base temporal:\n${arranque.stderr}`);

  try {
    let lista = false;
    for (let i = 0; i < 60 && !lista; i++) {
      lista = docker(['exec', nombre, 'pg_isready', '-U', 'postgres']).status === 0;
      if (!lista) spawnSync('node', ['-e', 'setTimeout(()=>{},1000)']);
    }
    if (!lista) falla('La base temporal no arrancó a tiempo.');

    if (docker(['cp', archivo, `${nombre}:/tmp/respaldo.dump`]).status !== 0) falla('No se pudo copiar el respaldo al contenedor.');
    const rest = docker(['exec', nombre, 'pg_restore', '-U', 'postgres', '-d', 'postgres', '--no-owner', '--no-privileges', '--exit-on-error', '/tmp/respaldo.dump']);
    if (rest.status !== 0) falla(`La restauración falló:\n${rest.stderr}`);
    const tiempo = segundos(inicio);

    const consulta = `
      SELECT 'tablas', count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
      UNION ALL SELECT 'indices', count(*) FROM pg_indexes WHERE schemaname='public'
      UNION ALL SELECT 'usuarios', count(*) FROM usuarios
      UNION ALL SELECT 'roles', count(*) FROM roles
      UNION ALL SELECT 'permisos', count(*) FROM rol_permisos
      UNION ALL SELECT 'productos', count(*) FROM productos
      UNION ALL SELECT 'mesas', count(*) FROM mesas
      UNION ALL SELECT 'pedidos', count(*) FROM pedidos
      UNION ALL SELECT 'transacciones', count(*) FROM transacciones_caja`;
    const q = docker(['exec', nombre, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-F', ': ', '-c', consulta]);
    if (q.status !== 0) falla(`No se pudo verificar la restauración:\n${q.stderr}`);
    console.log('Contenido restaurado:');
    console.log(q.stdout.trim().split('\n').map((l) => `  ${l}`).join('\n'));
    console.log(`Restauración correcta en ${tiempo} s (tiempo de recuperación medido, RTO).`);
  } finally {
    docker(['rm', '-f', nombre]);
  }
}

if (modo === 'probar') probar();
else crear();
