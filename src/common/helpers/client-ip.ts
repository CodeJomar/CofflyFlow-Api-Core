/**
 * IP del cliente. Se toma de `req.ip`, que Express resuelve según `trust proxy` (TRUSTED_PROXY_HOPS en main.ts):
 * solo se confía en los saltos de proxy configurados. NUNCA se leen directamente cabeceras como X-Forwarded-For,
 * X-Real-IP o CF-Connecting-IP, porque un cliente podría falsificarlas para esconder su origen o eludir límites.
 */
/** Lo mínimo que se necesita de una petición HTTP (Express) o de un handshake de socket. */
export interface PeticionConIp {
  ip?: string;
  socket?: { remoteAddress?: string };
}

export function getClientIp(req: PeticionConIp | undefined): string | null {
  const ip = req?.ip ?? req?.socket?.remoteAddress;
  return ip ? stripPort(ip) : null;
}

function stripPort(ip: string): string {
  if (!ip) return '';
  const v6 = ip.match(/^\[(.+)\]:\d+$/);
  if (v6) return v6[1];
  if (ip.includes('.') && ip.includes(':')) return ip.split(':')[0];
  return ip;
}
