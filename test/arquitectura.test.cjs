// Pruebas de la capa de seguridad y de coherencia, sin base de datos ni red (se ejecutan sobre dist):
//   cortafuegos de aplicación, cifrado de datos personales y coincidencia entre el esquema del ORM y database.sql.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { detectarAmenaza } = require('../dist/common/security/waf.js');
const { cifrarPii, descifrarPii, derivarClavePii, estaCifrado } = require('../dist/common/security/pii-cipher.js');

// ---------------------------------------------------------------- cortafuegos
const peticion = (extra) => ({ url: '/api/pedidos', userAgent: 'Mozilla/5.0', ...extra });

test('el cortafuegos bloquea firmas de ataque en la URL, los parámetros y el cuerpo', () => {
  assert.equal(detectarAmenaza(peticion({ url: '/api/../../etc/passwd' })), 'RECORRIDO_DE_RUTAS');
  assert.equal(detectarAmenaza(peticion({ url: '/api/%2e%2e/secreto' })), 'RECORRIDO_DE_RUTAS');
  assert.equal(detectarAmenaza(peticion({ userAgent: 'sqlmap/1.7' })), 'HERRAMIENTA_DE_ESCANEO');
  assert.equal(detectarAmenaza(peticion({ url: '/api/menu?q=1 union select 1,2' })), 'INYECCION_EN_URL');
  assert.equal(detectarAmenaza(peticion({ url: '/api/menu%00.png' })), 'BYTE_NULO');
  assert.equal(detectarAmenaza(peticion({ query: { busqueda: "x' OR '1'='1" } })), 'INYECCION_SQL');
  assert.equal(detectarAmenaza(peticion({ body: { email: "a@b.com' or 1=1 --", password: 'x' } })), 'INYECCION_SQL');
  assert.equal(detectarAmenaza(peticion({ body: { nota: '1; DROP TABLE usuarios' } })), 'INYECCION_SQL');
  assert.equal(detectarAmenaza(peticion({ body: { items: [{ nota: 'x UNION ALL SELECT password_hash FROM usuarios' }] } })), 'INYECCION_SQL');
  assert.equal(detectarAmenaza(peticion({ body: { nombre: '<script>alert(1)</script>' } })), 'SCRIPT_EN_DATOS');
  assert.equal(detectarAmenaza(peticion({ body: { nombre: '<img src=x onerror=alert(1)>' } })), 'SCRIPT_EN_DATOS');
  assert.equal(detectarAmenaza(peticion({ body: { url: 'javascript:alert(1)' } })), 'SCRIPT_EN_DATOS');
  assert.equal(detectarAmenaza(peticion({ body: { anidado: { a: { b: ["' or 'a'='a"] } } } })), 'INYECCION_SQL');
  // La clave de un objeto también se revisa
  assert.equal(detectarAmenaza(peticion({ body: { '<script>': 1 } })), 'SCRIPT_EN_DATOS');
});

test('el cortafuegos deja pasar texto legítimo de una cafetería', () => {
  const legitimos = [
    'Café con leche sin azúcar',
    "O'Brien & Sons",
    'Sandwich de pollo; sin cebolla',
    'Mesa 5 - terraza (cerca de la ventana)',
    'Pedido #12: 2 x Latte, 1 x Croissant',
    'Por favor, que la leche esté tibia. ¡Gracias!',
    'select una mesa y luego pagar',
    'ana.perez+demo@correo.com',
    'Ana María Pérez',
    'delete from carrito',
  ];
  for (const texto of legitimos) {
    assert.equal(detectarAmenaza(peticion({ body: { nota: texto, cliente_nombre: texto }, query: { busqueda: texto } })), null, texto);
  }
  assert.equal(detectarAmenaza(peticion({ url: '/api/menu/productos?pagina=2&limite=10', body: { cantidad: 3, precio: 12.5, activo: true } })), null);
  assert.equal(detectarAmenaza(peticion({})), null);
});

test('el cortafuegos no revienta con cuerpos muy anidados o enormes', () => {
  let profundo = { x: "' or 1=1" };
  for (let i = 0; i < 50; i++) profundo = { n: profundo };
  assert.doesNotThrow(() => detectarAmenaza(peticion({ body: profundo })));
  const grande = { lista: Array.from({ length: 5000 }, (_, i) => `texto ${i}`) };
  assert.equal(detectarAmenaza(peticion({ body: grande })), null);
});

// ---------------------------------------------------------------- cifrado de datos personales
const CLAVE = derivarClavePii('una-frase-larga-de-prueba-para-cifrar', undefined);

test('el cifrado de datos personales es reversible y no deja el dato legible', () => {
  const cifrado = cifrarPii('12345678', CLAVE);
  assert.ok(estaCifrado(cifrado));
  assert.ok(!cifrado.includes('12345678'));
  assert.equal(descifrarPii(cifrado, CLAVE), '12345678');
  assert.equal(descifrarPii(cifrarPii('+51 987 654 321', CLAVE), CLAVE), '+51 987 654 321');
  // Cada cifrado usa un vector distinto: el mismo dato no produce el mismo texto
  assert.notEqual(cifrarPii('12345678', CLAVE), cifrarPii('12345678', CLAVE));
});

test('el valor cifrado cabe en la columna de la base (255 caracteres)', () => {
  assert.ok(cifrarPii('A'.repeat(15), CLAVE).length < 255);
  assert.ok(cifrarPii('9'.repeat(20), CLAVE).length < 255);
});

test('un valor alterado o descifrado con otra clave se rechaza (autenticado)', () => {
  const cifrado = cifrarPii('12345678', CLAVE);
  const alterado = cifrado.slice(0, -2) + (cifrado.endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => descifrarPii(alterado, CLAVE));
  assert.throws(() => descifrarPii(cifrado, derivarClavePii('otra-clave-distinta-de-prueba-1234', undefined)));
});

test('el texto plano heredado se lee tal cual hasta que se cifre', () => {
  assert.equal(estaCifrado('12345678'), false);
  assert.equal(descifrarPii('12345678', CLAVE), '12345678');
});

test('la clave se toma de PII_ENCRYPTION_KEY o se deriva de JWT_SECRET', () => {
  assert.equal(CLAVE.length, 32);
  assert.equal(derivarClavePii('ab'.repeat(32), undefined).length, 32);
  assert.deepEqual(derivarClavePii(undefined, 'secreto-jwt-largo-de-prueba-0123456789'), derivarClavePii(undefined, 'secreto-jwt-largo-de-prueba-0123456789'));
  assert.notDeepEqual(derivarClavePii(undefined, 'secreto-jwt-largo-de-prueba-0123456789'), derivarClavePii(undefined, 'otro-secreto-jwt-de-prueba-9876543210'));
  assert.throws(() => derivarClavePii(undefined, undefined), /PII_ENCRYPTION_KEY/);
});

// ---------------------------------------------------------------- esquema del ORM frente a database.sql
function columnasDelScript(sql) {
  const limpio = sql.replace(/--[^\n]*/g, '');
  const tablas = {};
  const creates = /CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(/gi;
  let m;
  while ((m = creates.exec(limpio))) {
    let i = creates.lastIndex;
    let profundidad = 1;
    const inicio = i;
    while (profundidad > 0 && i < limpio.length) {
      if (limpio[i] === '(') profundidad++;
      else if (limpio[i] === ')') profundidad--;
      i++;
    }
    const cuerpo = limpio.slice(inicio, i - 1);
    const partes = [];
    let actual = '';
    let p = 0;
    for (const c of cuerpo) {
      if (c === '(') p++;
      if (c === ')') p--;
      if (c === ',' && p === 0) {
        partes.push(actual);
        actual = '';
      } else actual += c;
    }
    partes.push(actual);
    const columnas = {};
    for (const parte of partes) {
      const t = parte.trim().replace(/\s+/g, ' ');
      if (!t || /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)\b/i.test(t)) continue;
      const [nombre, tipo] = t.split(' ');
      const largo = /^varchar\((\d+)\)/i.exec(tipo || '');
      columnas[nombre] = largo ? Number(largo[1]) : null;
    }
    tablas[m[1]] = columnas;
  }
  const alters = /ALTER TABLE\s+(\w+)\s+ADD COLUMN(?: IF NOT EXISTS)?\s+(\w+)\s+(\S+)/gi;
  while ((m = alters.exec(limpio))) {
    const largo = /^varchar\((\d+)\)/i.exec(m[3]);
    (tablas[m[1]] ||= {})[m[2]] = largo ? Number(largo[1]) : null;
  }
  return tablas;
}

test('el esquema del ORM coincide con database.sql (tablas, columnas y largos de texto)', () => {
  const { getTableConfig } = require('drizzle-orm/pg-core');
  const esquema = require('../dist/common/database/schema/index.js');
  const sql = columnasDelScript(fs.readFileSync(path.join(__dirname, '..', 'database', 'database.sql'), 'utf8'));

  const delOrm = {};
  for (const valor of Object.values(esquema)) {
    let config;
    try {
      config = getTableConfig(valor);
    } catch {
      continue;
    }
    if (!config?.name || !config.columns) continue;
    delOrm[config.name] = Object.fromEntries(config.columns.map((c) => [c.name, c.columnType === 'PgVarchar' ? c.length : null]));
  }

  const diferencias = [];
  assert.ok(Object.keys(delOrm).length >= 18, 'el ORM debe declarar las 18 tablas');
  for (const tabla of new Set([...Object.keys(sql), ...Object.keys(delOrm)])) {
    if (!sql[tabla]) diferencias.push(`${tabla}: está en el ORM pero no en database.sql`);
    else if (!delOrm[tabla]) diferencias.push(`${tabla}: está en database.sql pero no en el ORM`);
    else {
      for (const col of new Set([...Object.keys(sql[tabla]), ...Object.keys(delOrm[tabla])])) {
        if (!(col in sql[tabla])) diferencias.push(`${tabla}.${col}: solo en el ORM`);
        else if (!(col in delOrm[tabla])) diferencias.push(`${tabla}.${col}: solo en database.sql`);
        else if (sql[tabla][col] !== delOrm[tabla][col]) diferencias.push(`${tabla}.${col}: largo ${sql[tabla][col]} en SQL y ${delOrm[tabla][col]} en el ORM`);
      }
    }
  }
  assert.deepEqual(diferencias, []);
});
