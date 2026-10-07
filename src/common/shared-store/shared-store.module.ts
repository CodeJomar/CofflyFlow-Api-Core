import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT, redisProvider } from './redis.provider';

/** Estado compartido entre instancias (Redis, opcional). Ver redis.provider.ts. */
@Global()
@Module({
  providers: [redisProvider],
  exports: [REDIS_CLIENT],
})
export class SharedStoreModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
