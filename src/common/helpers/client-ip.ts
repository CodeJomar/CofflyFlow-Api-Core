export function getClientIp(req: any): string | null {
  const directHeader = req?.headers?.['cf-connecting-ip'] || req?.headers?.['x-real-ip'];
  if (directHeader) {
    return stripPort(Array.isArray(directHeader) ? directHeader[0] : String(directHeader).trim());
  }

  const trustedHops = Number(process.env.TRUSTED_PROXY_HOPS) || 1;
  const raw = req?.headers?.['x-forwarded-for'];

  if (raw) {
    const parts = (Array.isArray(raw) ? raw.join(',') : String(raw))
      .split(',')
      .map((p: string) => p.trim())
      .filter(Boolean);

    if (parts.length) {
      const idx = Math.max(0, parts.length - trustedHops);
      return stripPort(parts[idx]);
    }
  }

  const fallback = req?.ip ?? req?.socket?.remoteAddress ?? req?.connection?.remoteAddress ?? null;
  return fallback ? stripPort(fallback) : null;
}

function stripPort(ip: string): string {
  if (!ip) return '';
  const v6 = ip.match(/^\[(.+)\]:\d+$/);
  if (v6) return v6[1];
  if (ip.includes('.') && ip.includes(':')) return ip.split(':')[0];
  return ip;
}