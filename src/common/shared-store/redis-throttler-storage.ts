import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { ThrottlerStorageService } from '@nestjs/throttler';
import type Redis from 'ioredis';

// Una sola operación atómica: cuenta el golpe, fija la ventana al primero y aplica el bloqueo al superar el límite.
// KEYS[1] contador, KEYS[2] bloqueo. ARGV: ttl_ms, limite, bloqueo_ms.
const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local bloqueo = redis.call('PTTL', KEYS[2])
if bloqueo > 0 then return {hits, ttl, 1, bloqueo} end
if hits > tonumber(ARGV[2]) then
  local ms = tonumber(ARGV[3])
  if ms <= 0 then ms = ttl end
  redis.call('SET', KEYS[2], '1', 'PX', ms)
  return {hits, ttl, 1, ms}
end
return {hits, ttl, 0, 0}
`;

/**
 * Almacén de límites de peticiones compartido entre instancias (Redis). Si Redis no responde, ese golpe se cuenta en
 * memoria local: el límite se vuelve por instancia durante la caída, pero la API sigue atendiendo.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly local = new ThrottlerStorageService();

  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `th:${throttlerName}:${key}`;
    try {
      const [hits, ttlMs, bloqueado, bloqueoMs] = (await this.redis.eval(
        SCRIPT,
        2,
        base,
        `${base}:b`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];
      return {
        totalHits: hits,
        timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
        isBlocked: bloqueado === 1,
        timeToBlockExpire: Math.max(0, Math.ceil(bloqueoMs / 1000)),
      };
    } catch {
      return this.local.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }
}
