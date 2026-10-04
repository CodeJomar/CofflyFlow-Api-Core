import { BaseResponse } from './base-response.dto';
import { MensajeQuery } from './mensaje-query.dto';

export class DetailQuery<TCabecera, TDetalle> extends BaseResponse {
  cabecera: TCabecera | null;
  detalles: TDetalle[];
  total_items: number;

  constructor(
    cabecera: TCabecera | null = null,
    detalles: TDetalle[] = [],
    status: string = 'OK',
    mensajes: MensajeQuery[] = [],
    trace: string = '',
  ) {
    super(status, mensajes, trace);
    this.cabecera = cabecera;
    this.detalles = detalles;
    this.total_items = detalles.length;
  }
}