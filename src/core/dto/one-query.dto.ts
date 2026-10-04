import { BaseResponse } from './base-response.dto';
import { MensajeQuery } from './mensaje-query.dto';

export class OneQuery<T> extends BaseResponse {
  data: T | null;

  constructor(
    data: T | null = null,
    status: string = 'OK',
    mensajes: MensajeQuery[] = [],
    trace: string = '',
  ) {
    super(status, mensajes, trace);
    this.data = data;
  }
}