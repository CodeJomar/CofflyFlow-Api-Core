export class MensajeQuery {
  codigo: string;
  descripcion: string;

  constructor(codigo: string = 'INFO_001', descripcion: string = 'Operación realizada exitosamente.') {
    this.codigo = codigo;
    this.descripcion = descripcion;
  }
}