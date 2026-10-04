import { BaseResponse } from './base-response.dto';
import { MensajeQuery } from './mensaje-query.dto';

export interface MetaPaginacion {
  total_registros: number;
  pagina_actual: number;
  total_paginas: number;
  limite_por_pagina: number;
  tiene_pagina_siguiente: boolean;
  tiene_pagina_anterior: boolean;
}

export class DataQuery<T> extends BaseResponse {
  data: T[];
  meta: MetaPaginacion;

  constructor(
    data: T[] = [],
    total_registros: number = 0,
    pagina_actual: number = 1,
    limite_por_pagina: number = 10,
    status: string = 'OK',
    mensajes: MensajeQuery[] = [],
    trace: string = '',
  ) {
    super(status, mensajes, trace);
    this.data = data;

    const total_paginas = Math.ceil(total_registros / (limite_por_pagina || 1)) || 1;

    this.meta = {
      total_registros,
      pagina_actual,
      total_paginas,
      limite_por_pagina,
      tiene_pagina_siguiente: pagina_actual < total_paginas,
      tiene_pagina_anterior: pagina_actual > 1,
    };
  }
}