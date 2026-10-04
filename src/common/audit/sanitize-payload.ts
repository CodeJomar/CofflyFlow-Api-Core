const CAMPOS_SENSIBLES = new Set([
  'password', 'pass', 'contrasena', 'contraseña', 'clave', 
  'token', 'access_token', 'refresh_token', 'authorization'
]);

export function sanitizePayload(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input !== 'object') return input;
  if (input instanceof Date || (typeof Buffer !== 'undefined' && Buffer.isBuffer(input))) return input;

  if (Array.isArray(input)) {
    return input.map((item) => sanitizePayload(item));
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (CAMPOS_SENSIBLES.has(key.toLowerCase())) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = sanitizePayload(value);
    }
  }
  return out;
}