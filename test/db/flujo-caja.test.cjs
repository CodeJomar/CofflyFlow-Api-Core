// Pruebas de punta a punta con base de datos real: arrancan la API compilada contra una base PostgreSQL vacía y recorren
// el flujo que más importa (sesión, cortafuegos, venta, cobro idempotente, movimientos, cierre de caja y cifrado de
// datos personales). Solo corren si hay TEST_DATABASE_URL; sin ella se omiten (no estorban en local).
//   TEST_DATABASE_URL=postgresql://postgres:test@localhost:55432/coffy npm run test:db
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const postgres = require('postgres');

const URL_BD = process.env.TEST_DATABASE_URL;
const RAIZ = path.join(__dirname, '..', '..');
const PUERTO = 4100;
const BASE = `http://127.0.0.1:${PUERTO}`;
const ORIGEN = 'http://localhost:3000';
const OWNER = { email: 'owner-prueba@coffy.test', password: 'Prueba123!' };
const entorno = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(PUERTO),
  DATABASE_URL: URL_BD,
  DB_SSL: 'false',
  JWT_SECRET: 'jwt-secreto-de-prueba-0123456789-abcdefghij',
  OTP_HMAC_SECRET: 'otp-secreto-de-prueba-9876543210-zyxwvutsrq',
  CORS_ORIGIN: ORIGEN,
  COOKIE_SECURE: 'false',
  MAIL_HOST: '127.0.0.1',
  MAIL_PORT: '2526',
  MAIL_REQUIRE_TLS: 'false',
  MAIL_USERNAME: 'x',
  MAIL_PASSWORD: 'x',
  WEB_URL: ORIGEN,
  SESSION_MAX_HOURS: '0.002', // 7,2 s: permite comprobar el tope absoluto de sesión
  OWNER_EMAIL: OWNER.email,
  OWNER_NAME: 'Dueño de Prueba',
  OWNER_PASSWORD: OWNER.password,
  BCRYPT_SALT_ROUNDS: '10',
};

// Servidor SMTP mínimo que guarda los correos que envía la API (para leer el enlace de activación).
const correos = [];
const sumidero = net.createServer((socket) => {
  let datos = false;
  let buffer = '';
  const responder = (t) => socket.write(t + '\r\n');
  responder('220 sumidero ESMTP');
  socket.on('data', (trozo) => {
    buffer += trozo.toString('latin1');
    if (datos) {
      if (!buffer.endsWith('\r\n.\r\n')) return;
      correos.push(buffer);
      buffer = '';
      datos = false;
      return responder('250 OK');
    }
    for (const linea of buffer.split('\r\n').slice(0, -1)) {
      const u = linea.toUpperCase();
      if (u.startsWith('EHLO') || u.startsWith('HELO')) {
        socket.write('250-sumidero' + String.fromCharCode(13, 10));
        responder('250 AUTH PLAIN LOGIN');
      } else if (u.startsWith('AUTH')) responder('235 Autenticado');
      else if (u.startsWith('DATA')) {
        datos = true;
        responder('354 Fin con .');
      } else if (u.startsWith('QUIT')) {
        responder('221 Adiós');
        socket.end();
      } else responder('250 OK');
    }
    if (!datos) buffer = '';
  });
  socket.on('error', () => {});
});

const opciones = { skip: URL_BD ? false : 'sin TEST_DATABASE_URL' };
let api;
let sql;
const jar = {};

const ejecutar = (args) => {
  const r = spawnSync(process.execPath, args, { cwd: RAIZ, env: entorno, encoding: 'utf8' });
  return { codigo: r.status, salida: (r.stdout || '') + (r.stderr || '') };
};

async function pedir(metodo, ruta, { cuerpo, cookies = jar, cabeceras = {}, base = BASE } = {}) {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { origin: ORIGEN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...cabeceras },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  for (const linea of res.headers.getSetCookie?.() ?? []) {
    const [par] = linea.split(';');
    const i = par.indexOf('=');
    const valor = par.slice(i + 1);
    if (valor) cookies[par.slice(0, i)] = valor;
    else delete cookies[par.slice(0, i)];
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    // sin cuerpo JSON
  }
  return { estado: res.status, json };
}

const sufijo = Date.now().toString(36);
const correoMozo = `mozo-${sufijo}@coffy.test`;
const clave = () => crypto.randomUUID().replace(/-/g, '').slice(0, 24);

test.before(async () => {
  if (!URL_BD) return;
  await new Promise((r) => sumidero.listen(2526, '127.0.0.1', r));
  sql = postgres(URL_BD, { max: 2, prepare: false, ssl: false, onnotice: () => {} });
  const [{ existe }] = await sql`SELECT to_regclass('public.usuarios') IS NOT NULL AS existe`;
  if (!existe) assert.equal(ejecutar(['scripts/db-crear.cjs']).codigo, 0, 'db-crear');
  assert.equal(ejecutar(['dist/scripts/seed-permisos.js']).codigo, 0, 'seed-permisos');
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM usuarios WHERE email = ${OWNER.email}`;
  if (n === 0) assert.equal(ejecutar(['dist/scripts/seed-owner.js']).codigo, 0, 'seed-owner');

  // Una ejecución anterior interrumpida pudo dejar un turno abierto: se cierra para partir de caja cerrada.
  await sql`UPDATE turnos_caja SET estado = 'cerrada', fecha_cierre = now(), monto_final_real = monto_inicial WHERE estado = 'abierta'`;

  // Empleado heredado con DNI y teléfono en texto plano y columnas cortas (como en una base anterior al cifrado).
  await sql`UPDATE usuarios SET dni = NULL, telefono = NULL`; // rastro de ejecuciones anteriores (no cabe en columnas cortas)
  await sql`ALTER TABLE usuarios ALTER COLUMN dni TYPE VARCHAR(15), ALTER COLUMN telefono TYPE VARCHAR(20)`;
  await sql`DELETE FROM usuarios WHERE email = 'legado@coffy.test'`;
  await sql`INSERT INTO usuarios (tipo_cuenta, id_rol, email, password_hash, nombre, estado, dni, telefono)
            SELECT 'EMPLOYEE', id_rol, 'legado@coffy.test', 'x', 'Legado', 'activo', '11112222', '987000111' FROM roles LIMIT 1`;

  api = spawn(process.execPath, ['dist/main.js'], { cwd: RAIZ, env: entorno, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/health/ready`)).ok) return;
    } catch {
      // aún no arranca
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('La API no arrancó en 30 s');
});

test.after(async () => {
  api?.kill();
  sumidero.close();
  await sql?.end();
});

test('el inicio de sesión rechaza credenciales malas con mensaje genérico y acepta las buenas', opciones, async () => {
  const mala = await pedir('POST', '/api/auth/login', { cuerpo: { email: OWNER.email, password: 'Incorrecta1!' }, cookies: {} });
  assert.equal(mala.estado, 401);
  assert.match(JSON.stringify(mala.json), /Credenciales inválidas/);
  const noExiste = await pedir('POST', '/api/auth/login', { cuerpo: { email: 'nadie@coffy.test', password: 'Incorrecta1!' }, cookies: {} });
  assert.equal(noExiste.estado, 401);
  assert.match(JSON.stringify(noExiste.json), /Credenciales inválidas/, 'mismo mensaje con un correo que no existe');

  const buena = await pedir('POST', '/api/auth/login', { cuerpo: OWNER });
  assert.equal(buena.estado, 200, JSON.stringify(buena.json));
  assert.ok(jar.cf_access && jar.cf_refresh, 'cookies de sesión');
  const yo = await pedir('GET', '/api/auth/me');
  assert.equal(yo.estado, 200);
});

test('el cortafuegos bloquea una inyección SQL en el cuerpo y deja rastro en la auditoría', opciones, async () => {
  const r = await pedir('POST', '/api/auth/login', { cuerpo: { email: "x@y.com' or 1=1 --", password: 'cualquiera1!' }, cookies: {} });
  assert.equal(r.estado, 403);
  await new Promise((res) => setTimeout(res, 500));
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM auditoria_seguridad WHERE evento = 'AMENAZA_WAF_BLOQUEADA'`;
  assert.ok(n >= 1, 'la amenaza debe quedar en la auditoría');
});

test('sin sesión no se accede a la caja', opciones, async () => {
  const r = await pedir('GET', '/api/transactions/turnos/actual', { cookies: {} });
  assert.equal(r.estado, 401);
});

test('flujo de caja: apertura, venta, cobro idempotente, retiro y cierre cuadrado', opciones, async () => {
  // Apertura
  const apertura = await pedir('POST', '/api/transactions/turnos/apertura', { cuerpo: { monto_inicial: '100.00' } });
  assert.equal(apertura.estado, 201, JSON.stringify(apertura.json));
  const idTurno = apertura.json.data.id_turno_caja;
  assert.ok(idTurno);
  const duplicada = await pedir('POST', '/api/transactions/turnos/apertura', { cuerpo: { monto_inicial: '50.00' } });
  assert.ok(duplicada.estado >= 400 && duplicada.estado < 500, 'no se abre un segundo turno');

  // Carta y venta
  const cat = await pedir('POST', '/api/menu/categorias', { cuerpo: { nombre: `Bebidas ${sufijo}` } });
  assert.equal(cat.estado, 201, JSON.stringify(cat.json));
  const prod = await pedir('POST', '/api/menu/productos', { cuerpo: { id_categoria: cat.json.data.id_categoria, nombre: `Latte ${sufijo}`, precio: '10.00' } });
  assert.equal(prod.estado, 201, JSON.stringify(prod.json));
  const pedido = await pedir('POST', '/api/orders', {
    cuerpo: { tipo_pedido: 'llevar', cliente_nombre: "O'Brien", items: [{ id_producto: prod.json.data.id_producto, cantidad: 2 }] },
    cabeceras: { 'idempotency-key': clave() },
  });
  assert.equal(pedido.estado, 201, JSON.stringify(pedido.json));
  const idPedido = pedido.json.data.id_pedido;
  assert.equal(Number(pedido.json.data.total_calculado), 20);

  // Cobro: sin clave de idempotencia no se acepta
  const sinClave = await pedir('POST', '/api/transactions/cobrar', { cuerpo: { id_pedido: idPedido, pagos: [{ metodo_pago: 'efectivo', monto: '20.00' }] } });
  assert.equal(sinClave.estado, 400);

  // Pago parcial (el sistema admite pagar en partes) y luego el saldo; el reintento con la misma clave no cobra dos veces
  const parcial = await pedir('POST', '/api/transactions/cobrar', {
    cuerpo: { id_pedido: idPedido, pagos: [{ metodo_pago: 'efectivo', monto: '5.00' }] },
    cabeceras: { 'idempotency-key': clave() },
  });
  assert.equal(parcial.estado, 201, JSON.stringify(parcial.json));
  const k = clave();
  const saldo = await pedir('POST', '/api/transactions/cobrar', {
    cuerpo: { id_pedido: idPedido, pagos: [{ metodo_pago: 'efectivo', monto: '15.00' }] },
    cabeceras: { 'idempotency-key': k },
  });
  assert.equal(saldo.estado, 201, JSON.stringify(saldo.json));
  const repetido = await pedir('POST', '/api/transactions/cobrar', {
    cuerpo: { id_pedido: idPedido, pagos: [{ metodo_pago: 'efectivo', monto: '15.00' }] },
    cabeceras: { 'idempotency-key': k },
  });
  assert.equal(repetido.estado, 200, 'el reintento con la misma clave no vuelve a cobrar');
  const demas = await pedir('POST', '/api/transactions/cobrar', {
    cuerpo: { id_pedido: idPedido, pagos: [{ metodo_pago: 'efectivo', monto: '20.00' }] },
    cabeceras: { 'idempotency-key': clave() },
  });
  assert.ok(demas.estado >= 400 && demas.estado < 500, `un pedido ya pagado no se cobra de nuevo (${demas.estado})`);
  const [{ cobros, total }] = await sql`
    SELECT count(*)::int AS cobros, coalesce(sum(monto), 0)::numeric AS total
      FROM transacciones_caja WHERE id_pedido = ${idPedido} AND tipo_movimiento = 'venta'`;
  assert.equal(cobros, 2, 'solo los dos cobros válidos quedan registrados');
  assert.equal(Number(total), 20, 'se cobró exactamente el total del pedido');

  // Retiro manual y cierre: 100 inicial + 20 cobrado - 5 retiro = 115
  const retiro = await pedir('POST', '/api/transactions/movimientos', {
    cuerpo: { tipo_movimiento: 'retiro_manual', metodo_pago: 'efectivo', monto: '5.00', notas: 'Compra de hielo' },
  });
  assert.equal(retiro.estado, 201, JSON.stringify(retiro.json));
  const cierre = await pedir('POST', `/api/transactions/turnos/${idTurno}/cierre`, { cuerpo: { monto_final_real: '115.00' } });
  assert.equal(cierre.estado, 201, JSON.stringify(cierre.json));
  assert.equal(Number(cierre.json.data.diferencia), 0);
  assert.equal(cierre.json.data.estado, 'cerrada');

  // Con la caja cerrada no se vende
  const tarde = await pedir('POST', '/api/orders', {
    cuerpo: { tipo_pedido: 'llevar', items: [{ id_producto: prod.json.data.id_producto, cantidad: 1 }] },
    cabeceras: { 'idempotency-key': clave() },
  });
  assert.ok(tarde.estado >= 400 && tarde.estado < 500, `sin turno abierto no se crea pedido: ${tarde.estado}`);
});

test('un cierre con dinero de menos queda como descuadre', opciones, async () => {
  const apertura = await pedir('POST', '/api/transactions/turnos/apertura', { cuerpo: { monto_inicial: '50.00' } });
  assert.equal(apertura.estado, 201, JSON.stringify(apertura.json));
  const cierre = await pedir('POST', `/api/transactions/turnos/${apertura.json.data.id_turno_caja}/cierre`, { cuerpo: { monto_final_real: '45.00' } });
  assert.equal(cierre.estado, 201, JSON.stringify(cierre.json));
  assert.equal(Number(cierre.json.data.diferencia), -5);
  assert.equal(cierre.json.data.estado, 'descuadre');
});

test('el DNI y el teléfono del empleado se guardan cifrados y se leen en claro', opciones, async () => {
  const cargos = await pedir('GET', '/api/users/cargos');
  assert.equal(cargos.estado, 200, JSON.stringify(cargos.json));
  const idRol = (cargos.json.data ?? cargos.json.items)[0].id_rol;
  const alta = await pedir('POST', '/api/users', { cuerpo: { id_rol: idRol, email: correoMozo, nombre: 'Mozo de Prueba', dni: '45678912', telefono: '+51 987 654 321' } });
  assert.equal(alta.estado, 201, JSON.stringify(alta.json));
  assert.equal(alta.json.data.dni, '45678912');

  const [crudo] = await sql`SELECT dni, telefono, estado FROM usuarios WHERE email = ${correoMozo}`;
  assert.match(crudo.dni, /^enc1:/);
  assert.match(crudo.telefono, /^enc1:/);
  assert.ok(!crudo.dni.includes('45678912'));
  assert.equal(crudo.estado, 'pendiente_activacion');

  const lectura = await pedir('GET', `/api/users/${alta.json.data.id_usuario}`);
  assert.equal(lectura.json.data.dni, '45678912');
  assert.equal(lectura.json.data.telefono, '+51 987 654 321');

  const edicion = await pedir('PATCH', `/api/users/${alta.json.data.id_usuario}`, { cuerpo: { telefono: '999111222' } });
  assert.equal(edicion.estado, 200, JSON.stringify(edicion.json));
  assert.equal(edicion.json.data.telefono, '999111222');
  const [crudo2] = await sql`SELECT telefono FROM usuarios WHERE email = ${correoMozo}`;
  assert.match(crudo2.telefono, /^enc1:/);
});

function enlaceDeActivacion(correo) {
  const texto = correo.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const m = /activar-cuenta\?token=([A-Za-z0-9_%.-]+)/.exec(texto);
  return m ? decodeURIComponent(m[1]) : null;
}

test('el correo de activación llega con un enlace que se valida y permite activar la cuenta', opciones, async () => {
  const cargos = await pedir('GET', '/api/users/cargos');
  const idRol = (cargos.json.data ?? cargos.json.items)[0].id_rol;
  const correo = `activar-${sufijo}@coffy.test`;
  const antes = correos.length;
  const alta = await pedir('POST', '/api/users', { cuerpo: { id_rol: idRol, email: correo, nombre: 'Persona Activa' } });
  assert.equal(alta.estado, 201, JSON.stringify(alta.json));
  for (let i = 0; i < 20 && correos.length === antes; i++) await new Promise((r) => setTimeout(r, 200));
  assert.equal(correos.length, antes + 1, 'se envió un correo');
  const token = enlaceDeActivacion(correos[correos.length - 1]);
  assert.ok(token, 'el correo trae el enlace de activación');

  const validar = await pedir('POST', '/api/auth/activar/validar', { cuerpo: { token }, cookies: {} });
  assert.equal(validar.estado, 200, JSON.stringify(validar.json));
  const activar = await pedir('POST', '/api/auth/activar', { cuerpo: { token, password: 'Nueva123!' }, cookies: {} });
  assert.equal(activar.estado, 200, JSON.stringify(activar.json));
  const reuso = await pedir('POST', '/api/auth/activar/validar', { cuerpo: { token }, cookies: {} });
  assert.equal(reuso.estado, 400, 'el enlace es de un solo uso');
  const login = await pedir('POST', '/api/auth/login', { cuerpo: { email: correo, password: 'Nueva123!' }, cookies: {} });
  assert.equal(login.estado, 200, JSON.stringify(login.json));
  // Cuenta suspendida: con la contraseña correcta se avisa con claridad; con una incorrecta sigue el mensaje genérico.
  const [{ id }] = await sql`SELECT id_usuario AS id FROM usuarios WHERE email = ${correo}`;
  const suspension = await pedir('PATCH', `/api/users/${id}`, { cuerpo: { estado: 'suspendido' } });
  assert.equal(suspension.estado, 200, JSON.stringify(suspension.json));
  const aviso = await pedir('POST', '/api/auth/login', { cuerpo: { email: correo, password: 'Nueva123!' }, cookies: {} });
  assert.equal(aviso.estado, 403);
  assert.match(JSON.stringify(aviso.json), /suspendida/);
  const generico = await pedir('POST', '/api/auth/login', { cuerpo: { email: correo, password: 'Otra12345!' }, cookies: {} });
  assert.equal(generico.estado, 401);
  assert.match(JSON.stringify(generico.json), /Credenciales inválidas/);
});

test('al arrancar, la API amplía las columnas y cifra los datos personales que estaban en texto plano', opciones, async () => {
  const [col] = await sql`SELECT character_maximum_length AS largo FROM information_schema.columns WHERE table_name = 'usuarios' AND column_name = 'dni'`;
  assert.equal(col.largo, 255);
  const [legado] = await sql`SELECT dni, telefono FROM usuarios WHERE email = 'legado@coffy.test'`;
  assert.match(legado.dni, /^enc1:/);
  assert.match(legado.telefono, /^enc1:/);
});

test('la sesión no se renueva pasado el tope absoluto', opciones, async () => {
  const sesion = {};
  const login = await pedir('POST', '/api/auth/login', { cuerpo: OWNER, cookies: sesion });
  assert.equal(login.estado, 200);
  const antes = await pedir('POST', '/api/auth/refresh', { cookies: sesion });
  assert.equal(antes.estado, 200, 'dentro del tope se renueva');
  await new Promise((r) => setTimeout(r, 8000));
  const despues = await pedir('POST', '/api/auth/refresh', { cookies: sesion });
  assert.equal(despues.estado, 401, 'pasado el tope ya no se renueva');
});

test('la sesión se cierra por inactividad y solo la actividad real del usuario la mantiene viva', opciones, async () => {
  // Segunda instancia de la API con 1,8 s de inactividad permitida (las consultas automáticas no deben mantenerla viva).
  const puerto = 4101;
  const base = `http://127.0.0.1:${puerto}`;
  const api2 = spawn(process.execPath, ['dist/main.js'], {
    cwd: RAIZ,
    env: { ...entorno, PORT: String(puerto), SESSION_IDLE_MINUTES: '0.03', SESSION_MAX_HOURS: '1', MAIL_PORT: '2526' },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${base}/health/ready`)).ok) break;
      } catch {
        // aún no arranca
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
    const iniciar = async () => {
      const sesion = {};
      const login = await pedir('POST', '/api/auth/login', { cuerpo: OWNER, cookies: sesion, base });
      assert.equal(login.estado, 200, JSON.stringify(login.json));
      assert.equal(login.json.data.usuario.inactividad_segundos, 2, 'la API informa cuánta inactividad admite');
      return sesion;
    };

    // 1) Solo consultas automáticas (sin actividad del usuario): no mantienen viva la sesión
    const soloConsultas = await iniciar();
    await dormir(1000);
    assert.equal((await pedir('GET', '/api/auth/me', { cookies: soloConsultas, base })).estado, 200, 'aún dentro del límite');
    await dormir(1300);
    assert.equal((await pedir('GET', '/api/auth/me', { cookies: soloConsultas, base })).estado, 401, 'las consultas no cuentan como actividad');
    assert.equal((await pedir('POST', '/api/auth/refresh', { cookies: soloConsultas, base })).estado, 401, 'una sesión inactiva tampoco se renueva');

    // 2) Con actividad real del usuario (latido) la sesión sigue viva, y al dejar de actuar muere
    const conActividad = await iniciar();
    await dormir(1000);
    const latido = await pedir('POST', '/api/auth/actividad', { cookies: conActividad, base });
    assert.equal(latido.estado, 200, JSON.stringify(latido.json));
    await dormir(1000);
    assert.equal((await pedir('GET', '/api/auth/me', { cookies: conActividad, base })).estado, 200, 'el latido la mantuvo viva');
    await dormir(1300);
    assert.equal((await pedir('GET', '/api/auth/me', { cookies: conActividad, base })).estado, 401, 'sin más actividad muere');
  } finally {
    api2.kill();
  }
});
