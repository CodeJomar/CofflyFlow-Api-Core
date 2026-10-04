import { BaseResponse } from './base-response.dto';
import { MensajeQuery } from './mensaje-query.dto';

export class CheckStatus<T> extends BaseResponse {
  data: T | null;

  constructor(status: string = 'OK', mensajes: MensajeQuery[] = [], trace: string = '', data: T | null = null) {
    super(status, mensajes, trace);
    this.data = data;
  }
}