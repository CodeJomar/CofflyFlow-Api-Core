/**
 * Validación de configuración al ARRANCAR (se pasa a ConfigModule.forRoot({ validate })). Si falta algo crítico
 * o es inseguro, la API no inicia: mejor fallar al desplegar que operar con secretos débiles.
 * En desarrollo los problemas de endurecimiento son avisos; en producción son errores.
 */
const PLACEHOLDERS = /^(changeme|change_me|secret|password|falta_configurar|your[-_ ]|xxx|test)/i;

export function validarEntorno(config: Record<string, unknown>): Record<string, unknown> {
  const env = config as Record<string, string | undefined>;
  const produccion = env.NODE_ENV === 'production';
  const errores: string[] = [];
  const avisos: string[] = [];

  const requerida = (nombre: string) => {
    if (!env[nombre]?.trim()) errores.push(`${nombre} es obligatoria.`);
  };
  const secreto = (nombre: string, minimo = 32) => {
    const valor = env[nombre]?.trim();
    if (!valor) return errores.push(`${nombre} es obligatoria.`);
    if (valor.length < minimo || PLACEHOLDERS.test(valor)) {
      (produccion ? errores : avisos).push(`${nombre} es débil: usa un valor aleatorio de al menos ${minimo} caracteres.`);
    }
  };

  requerida('DATABASE_URL');
  secreto('JWT_SECRET');
  secreto('OTP_HMAC_SECRET');
  if (env.JWT_SECRET && env.OTP_HMAC_SECRET && env.JWT_SECRET === env.OTP_HMAC_SECRET) {
    (produccion ? errores : avisos).push('JWT_SECRET y OTP_HMAC_SECRET deben ser distintos.');
  }

  // Observabilidad (opt-in): las credenciales van en pareja.
  if (Boolean(env.OBSERVE_APP_KEY?.trim()) !== Boolean(env.OBSERVE_APP_SECRET?.trim())) {
    errores.push('OBSERVE_APP_KEY y OBSERVE_APP_SECRET deben definirse juntas (o ninguna, para dejar el APM apagado).');
  }

  if (env.REDIS_URL?.trim() && !env.REDIS_URL.trim().startsWith('redis')) {
    errores.push('REDIS_URL debe empezar por redis:// o rediss://.');
  }

  const rondas = Number(env.BCRYPT_SALT_ROUNDS ?? 12);
  if (!Number.isInteger(rondas) || rondas < 10 || rondas > 15) {
    (produccion ? errores : avisos).push('BCRYPT_SALT_ROUNDS debe ser un entero entre 10 y 15.');
  }

  if (produccion) {
    requerida('CORS_ORIGIN');
    requerida('WEB_URL');
    requerida('MAIL_HOST');
    requerida('MAIL_USERNAME');
    requerida('MAIL_PASSWORD');
    if (env.COOKIE_SECURE === 'false') errores.push('COOKIE_SECURE no puede ser "false" en producción (las cookies de sesión deben ser Secure).');
    if (env.CORS_ORIGIN?.split(',').some((o) => o.trim() === '*')) errores.push('CORS_ORIGIN no puede ser "*".');
    if (env.WEB_URL && !env.WEB_URL.startsWith('https://')) errores.push('WEB_URL debe usar https:// en producción (los enlaces de activación viajan por correo).');
    if (!env.REDIS_URL?.trim()) avisos.push('REDIS_URL no definida: límites de peticiones, intentos de login y eventos WS quedan por instancia (no escalar a más de una).');
    if (env.DB_SSL === 'false') avisos.push('DB_SSL=false: la conexión a la base de datos no usa TLS.');
  }

  for (const aviso of avisos) console.warn(`[config] AVISO: ${aviso}`);
  if (errores.length > 0) {
    throw new Error(`Configuración inválida:\n - ${errores.join('\n - ')}`);
  }
  return config;
}
