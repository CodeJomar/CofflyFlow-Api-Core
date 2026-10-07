import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface EventoTiempoReal {
  evento: string;
  payload: unknown;
}

/**
 * Bus interno de eventos en tiempo real. Los servicios de negocio publican aquí (después del commit) y el gateway
 * WebSocket los difunde a las pantallas. Así Pedidos, Mesas y KDS no se importan entre sí (sin dependencias circulares).
 */
@Injectable()
export class RealtimeBus {
  private readonly flujo = new Subject<EventoTiempoReal>();

  readonly eventos$: Observable<EventoTiempoReal> = this.flujo.asObservable();

  emitir(evento: string, payload: unknown): void {
    this.flujo.next({ evento, payload });
  }
}
