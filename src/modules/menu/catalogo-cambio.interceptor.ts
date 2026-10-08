import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RealtimeBus } from '../../common/realtime/realtime-bus.service';

/**
 * Avisa en tiempo real (`menu:catalogo-actualizado`) cuando el menú cambia: productos, categorías o modificadores.
 * El POS y el menú abiertos lo usan para recargar el catálogo sin esperar al sondeo. Solo se emite DESPUÉS de que la
 * escritura terminó bien; las lecturas (GET) no emiten nada.
 */
@Injectable()
export class CatalogoCambioInterceptor implements NestInterceptor {
  constructor(private readonly bus: RealtimeBus) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ method: string; route?: { path?: string } }>();
    const escritura = req.method !== 'GET';
    const ruta = req.route?.path ?? '';
    const recurso = ruta.includes('categorias') ? 'categorias' : ruta.includes('productos') && !ruta.includes('grupos-modificadores') ? 'productos' : 'modificadores';
    return next.handle().pipe(
      tap(() => {
        if (escritura) this.bus.emitir('menu:catalogo-actualizado', { recurso, accion: req.method });
      }),
    );
  }
}
