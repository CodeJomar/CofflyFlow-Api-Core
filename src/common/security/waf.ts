/**
 * Reglas del cortafuegos de aplicación (WAF). Funciones puras, sin Nest ni red: las usa el middleware y las pruebas.
 * Revisan la URL, el agente de usuario, los parámetros de la consulta y el cuerpo JSON. Solo bloquean firmas de ataque
 * claras (no palabras sueltas), porque el texto de un pedido o un nombre no debe dar falsos positivos; la defensa de
 * fondo contra inyección SQL sigue siendo la consulta parametrizada.
 */
export type MotivoWaf = 'RECORRIDO_DE_RUTAS' | 'HERRAMIENTA_DE_ESCANEO' | 'INYECCION_EN_URL' | 'INYECCION_SQL' | 'SCRIPT_EN_DATOS' | 'BYTE_NULO';

const RECORRIDO = /(\.\.[/\\]|%2e%2e[/\\]|\/etc\/passwd|\/windows\/win\.ini)/i;
const ESCANERES = /\b(sqlmap|nikto|nmap|masscan|acunetix|dirbuster|gobuster)\b/i;
const INYECCION_URL = /<\s*script|union\s+select|benchmark\s*\(|sleep\s*\(/i;

// Firmas de inyección SQL en datos: tautologías con comilla, UNION SELECT, sentencias apiladas destructivas,
// esquema del catálogo y funciones de retardo.
const INYECCION_SQL = [
  /['"]\s*(or|and)\s+['"]?\w+['"]?\s*=\s*['"]?\w+/i,
  /\bunion\s+(all\s+)?select\b/i,
  /;\s*(drop|truncate|alter|delete\s+from|insert\s+into|update\s+\w+\s+set)\b/i,
  /\binformation_schema\b|\bpg_catalog\b|\bpg_sleep\s*\(/i,
  /\bsleep\s*\(\s*\d+\s*\)|\bbenchmark\s*\(\s*\d+\s*,|\bwaitfor\s+delay\s+['"]/i,
];

// Código que se ejecutaría en un navegador si se mostrara sin escapar.
const SCRIPT = /<\s*\/?\s*(script|iframe|object|embed|svg)\b|javascript\s*:|\bon(error|load|click|mouseover)\s*=/i;

const PROFUNDIDAD_MAXIMA = 6;
const TEXTOS_MAXIMOS = 300;

function textosDe(valor: unknown, salida: string[], profundidad = 0): void {
  if (salida.length >= TEXTOS_MAXIMOS || profundidad > PROFUNDIDAD_MAXIMA) return;
  if (typeof valor === 'string') {
    salida.push(valor);
  } else if (Array.isArray(valor)) {
    for (const v of valor) textosDe(v, salida, profundidad + 1);
  } else if (valor && typeof valor === 'object') {
    for (const [clave, v] of Object.entries(valor)) {
      salida.push(clave);
      textosDe(v, salida, profundidad + 1);
    }
  }
}

function decodificar(texto: string): string {
  try {
    return decodeURIComponent(texto);
  } catch {
    return texto;
  }
}

export interface PeticionWaf {
  url: string;
  userAgent?: string;
  query?: unknown;
  body?: unknown;
}

/** Devuelve el motivo del bloqueo, o null si la petición puede seguir. */
export function detectarAmenaza(peticion: PeticionWaf): MotivoWaf | null {
  const url = decodificar(peticion.url || '');
  if (url.includes('\0') || /%00/.test(peticion.url || '')) return 'BYTE_NULO';
  if (RECORRIDO.test(url)) return 'RECORRIDO_DE_RUTAS';
  if (ESCANERES.test(peticion.userAgent || '')) return 'HERRAMIENTA_DE_ESCANEO';
  if (INYECCION_URL.test(url)) return 'INYECCION_EN_URL';

  const textos: string[] = [];
  textosDe(peticion.query, textos);
  textosDe(peticion.body, textos);
  for (const texto of textos) {
    if (texto.includes('\0')) return 'BYTE_NULO';
    const t = decodificar(texto);
    if (INYECCION_SQL.some((r) => r.test(t))) return 'INYECCION_SQL';
    if (SCRIPT.test(t)) return 'SCRIPT_EN_DATOS';
  }
  return null;
}
