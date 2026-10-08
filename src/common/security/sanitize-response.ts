/**
 * Campos que NUNCA deben salir en una respuesta: columnas internas de auditoría (revelan qué usuario creó o editó
 * cada registro), secretos/hashes y contadores de seguridad. Los servicios devuelven a veces la fila completa
 * (`.returning()`); esta lista actúa como red de seguridad global además de que cada endpoint de autenticación
 * devuelve un DTO explícito.
 */
const CAMPOS_INTERNOS = new Set([
  'usuario_creacion',
  'despachado_por',
  'id_usuario_apertura',
  'id_usuario_cierre',
  'huella_solicitud',
  'clave_idempotencia',
  'usuario_edicion',
  'eliminado',
  'password_hash',
  'refresh_token_hash',
  'codigo_hash',
  'familia_token',
  'intentos_fallidos',
  'bloqueado_hasta',
  'ultimo_cambio_password',
  'email_verificado_el',
]);

export function sanitizarRespuesta<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map(sanitizarRespuesta) as T;
  if (valor === null || typeof valor !== 'object' || valor instanceof Date || Buffer.isBuffer(valor)) return valor;

  const limpio: Record<string, unknown> = {};
  for (const [clave, contenido] of Object.entries(valor as Record<string, unknown>)) {
    if (CAMPOS_INTERNOS.has(clave)) continue;
    limpio[clave] = sanitizarRespuesta(contenido);
  }
  return limpio as T;
}
