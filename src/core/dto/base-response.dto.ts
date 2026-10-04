import { MensajeQuery } from './mensaje-query.dto';

export class BaseResponse {
  status: string;
  mensajes: MensajeQuery[];
  trace: string;

  constructor(status: string = 'OK', mensajes: MensajeQuery[] = [], trace: string = '') {
    this.status = status;
    this.mensajes = mensajes;
    this.trace = trace;
  }
}