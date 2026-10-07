import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';

/**
 * Adaptador de Socket.IO sobre Redis: un evento emitido desde una instancia de la API llega a las pantallas
 * conectadas a CUALQUIER instancia. Sin Redis, el adaptador por defecto (solo esa instancia).
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly registro = new Logger(RedisIoAdapter.name);
  private adaptador?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext, cliente: Redis | null) {
    super(app);
    if (!cliente) return;
    // El suscriptor necesita cola offline para poder suscribirse mientras conecta; el publicador falla rápido.
    const pub = cliente.duplicate();
    const sub = cliente.duplicate({ enableOfflineQueue: true });
    for (const c of [pub, sub]) c.on('error', () => undefined); // el aviso ya lo da el cliente principal
    this.adaptador = createAdapter(pub, sub);
    this.registro.log('Eventos WebSocket compartidos entre instancias (Redis).');
  }

  createIOServer(...args: Parameters<IoAdapter['createIOServer']>): ReturnType<IoAdapter['createIOServer']> {
    const server = super.createIOServer(...args);
    if (this.adaptador) server.adapter(this.adaptador as unknown as Parameters<typeof server.adapter>[0]);
    return server;
  }
}
