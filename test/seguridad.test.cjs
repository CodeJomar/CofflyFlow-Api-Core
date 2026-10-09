// Pruebas de seguridad necesarias, sin base de datos ni red. Se ejecutan sobre el código compilado:
//   npm run build && npm test
// Cubren lo que más protege al sistema: el arranque se niega con configuración insegura, la matriz de permisos no
// da de más, y las reglas de entrada (contraseña y texto) rechazan lo que deben.
const test = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');

const { validarEntorno } = require('../dist/common/config/env.validation.js');
const { PERMISOS_POR_CARGO, MODULO, ACCION } = require('../dist/common/security/permission-matrix.js');
const { getCorsOrigins } = require('../dist/common/config/cors-origins.js');
const { CambiarPasswordDto, ActualizarPerfilDto } = require('../dist/modules/auth/dto/profile.dto.js');

const SECRETO_A = 'A'.repeat(20) + 'bcdefghijkl123456789';
const SECRETO_B = 'B'.repeat(20) + 'mnopqrstuvw987654321';

const entornoValido = () => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@host:5432/db',
  JWT_SECRET: SECRETO_A,
  OTP_HMAC_SECRET: SECRETO_B,
  CORS_ORIGIN: 'https://web.ejemplo.com',
  WEB_URL: 'https://web.ejemplo.com',
  MAIL_HOST: 'smtp.ejemplo.com',
  MAIL_USERNAME: 'usuario',
  MAIL_PASSWORD: 'clave',
});

const sinAvisos = (fn) => {
  const original = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = original;
  }
};
const rechaza = (cambios, parteDelMensaje) =>
  assert.throws(() => sinAvisos(() => validarEntorno({ ...entornoValido(), ...cambios })), (e) => e.message.includes(parteDelMensaje));

// ---------------------------------------------------------------- arranque seguro
test('el arranque acepta una configuración de producción válida', () => {
  assert.doesNotThrow(() => sinAvisos(() => validarEntorno(entornoValido())));
});

test('en producción el arranque se niega con configuración insegura', () => {
  rechaza({ JWT_SECRET: 'corto' }, 'JWT_SECRET es débil');
  rechaza({ JWT_SECRET: 'changeme-' + 'x'.repeat(30) }, 'JWT_SECRET es débil');
  rechaza({ OTP_HMAC_SECRET: SECRETO_A }, 'deben ser distintos');
  rechaza({ COOKIE_SECURE: 'false' }, 'COOKIE_SECURE');
  rechaza({ CORS_ORIGIN: '*' }, 'CORS_ORIGIN');
  rechaza({ WEB_URL: 'http://web.ejemplo.com' }, 'WEB_URL');
  rechaza({ DATABASE_URL: '' }, 'DATABASE_URL');
  rechaza({ MAIL_HOST: '' }, 'MAIL_HOST');
});

test('fuera de producción lo inseguro solo da avisos', () => {
  assert.doesNotThrow(() => sinAvisos(() => validarEntorno({ ...entornoValido(), NODE_ENV: 'development', JWT_SECRET: 'corto' })));
});

test('CORS sin configurar solo permite el origen de desarrollo', () => {
  const anterior = process.env.CORS_ORIGIN;
  delete process.env.CORS_ORIGIN;
  assert.deepEqual(getCorsOrigins(), ['http://localhost:3000']);
  process.env.CORS_ORIGIN = 'https://a.com, https://b.com';
  assert.deepEqual(getCorsOrigins(), ['https://a.com', 'https://b.com']);
  if (anterior === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = anterior;
});

// ---------------------------------------------------------------- permisos
const permisos = (cargo) => new Set(PERMISOS_POR_CARGO[cargo].map(([m, a]) => `${m}:${a}`));

test('la matriz de permisos solo usa módulos y acciones definidos', () => {
  const modulos = new Set(Object.values(MODULO));
  const acciones = new Set(Object.values(ACCION));
  for (const [cargo, lista] of Object.entries(PERMISOS_POR_CARGO)) {
    for (const [modulo, accion] of lista) {
      assert.ok(modulos.has(modulo), `${cargo}: módulo desconocido ${modulo}`);
      assert.ok(acciones.has(accion), `${cargo}: acción desconocida ${accion}`);
    }
  }
});

test('ningún cargo administra usuarios, roles ni el panel', () => {
  for (const cargo of Object.keys(PERMISOS_POR_CARGO)) {
    for (const p of permisos(cargo)) {
      assert.ok(!p.startsWith('USERS:') && !p.startsWith('ROLES:') && !p.startsWith('DASHBOARD:'), `${cargo} tiene ${p}`);
    }
  }
});

test('solo el cajero cobra, arquea y anula', () => {
  assert.ok(permisos('CASHIER').has('TRANSACTIONS:COBRAR'));
  assert.ok(permisos('CASHIER').has('TRANSACTIONS:ARQUEAR'));
  for (const cargo of ['WAITER', 'BARISTA', 'OPERATOR']) {
    assert.ok(!permisos(cargo).has('TRANSACTIONS:COBRAR'), `${cargo} no debe cobrar`);
    assert.ok(![...permisos(cargo)].some((p) => p.startsWith('TRANSACTIONS:')), `${cargo} no debe tocar caja`);
    assert.ok(!permisos(cargo).has('ORDERS:ANULAR'), `${cargo} no debe anular`);
  }
});

test('solo el barista despacha en el KDS y el mozo no lo ve', () => {
  assert.ok(permisos('BARISTA').has('KDS:DESPACHAR'));
  assert.ok(![...permisos('WAITER')].some((p) => p.startsWith('KDS:')));
  assert.ok(!permisos('OPERATOR').has('KDS:DESPACHAR'));
});

// ---------------------------------------------------------------- reglas de entrada
const errores = (clase, datos) => validateSync(plainToInstance(clase, datos)).length;

test('la política de contraseña nueva exige 8 caracteres con letras, números y un símbolo', () => {
  const dto = (password_nueva) => ({ password_actual: 'cualquiera', password_nueva });
  assert.ok(errores(CambiarPasswordDto, dto('abc123')) > 0, 'muy corta');
  assert.ok(errores(CambiarPasswordDto, dto('abcdefghij')) > 0, 'sin números');
  assert.ok(errores(CambiarPasswordDto, dto('1234567890')) > 0, 'sin letras');
  assert.ok(errores(CambiarPasswordDto, dto('a1'.repeat(40))) > 0, 'demasiado larga');
  assert.equal(errores(CambiarPasswordDto, dto('Jomar123!')), 0);
  assert.equal(errores(CambiarPasswordDto, dto('Clave-segura-2026')), 0);
  assert.ok(errores(CambiarPasswordDto, dto('Jomar123')) > 0, 'sin símbolo');
});

test('los textos libres rechazan etiquetas HTML y aceptan texto normal', () => {
  assert.ok(errores(ActualizarPerfilDto, { nombre: '<script>alert(1)</script>' }) > 0);
  assert.ok(errores(ActualizarPerfilDto, { nombre: 'Ana <img src=x onerror=alert(1)>' }) > 0);
  assert.equal(errores(ActualizarPerfilDto, { nombre: 'Ana María Pérez' }), 0);
  assert.ok(errores(ActualizarPerfilDto, { nombre: '' }) > 0, 'vacío');
});

test('un nombre de persona solo admite letras y signos sueltos', () => {
  for (const bueno of ['Ana María Pérez', "O'Brien", 'Jean-Luc Picard', 'Dr. Pérez', 'Ñandú Quispe']) {
    assert.equal(errores(ActualizarPerfilDto, { nombre: bueno }), 0, bueno);
  }
  for (const malo of ['Valeria Soto Medina.--.', 'Ana & Luis', 'Ana2', '-Ana', 'Ana  Pérez', '!!!', 'Ana 🙂']) {
    assert.ok(errores(ActualizarPerfilDto, { nombre: malo }) > 0, malo);
  }
});

test('los motivos y notas rechazan rachas de símbolos y emojis, y aceptan texto normal', () => {
  const { MovimientoCajaDto } = require('../dist/modules/transactions/dto/movimiento-caja.dto.js');
  const base = { tipo_movimiento: 'retiro_manual', metodo_pago: 'efectivo', monto: '5.00' };
  for (const bueno of ['Compra de hielo (S/ 5.50)', 'Pago a proveedor: café y leche', 'Retiro #3 - cambio de caja', "Vuelto 'extra' 10%"]) {
    assert.equal(errores(MovimientoCajaDto, { ...base, notas: bueno }), 0, bueno);
  }
  for (const malo of ['!"#"$!"$#"%$"#%#$%', '###', 'ok ¡¡¡¡', 'hielo 🙂', 'a ~ b', 'x {y}']) {
    assert.ok(errores(MovimientoCajaDto, { ...base, notas: malo }) > 0, malo);
  }
});
