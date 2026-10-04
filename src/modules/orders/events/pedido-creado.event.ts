export class PedidoCreadoEvent {
  constructor(
    public readonly id_pedido: string,
    public readonly id_mesa: string | null,
    public readonly numero_mesa: string | null,
    public readonly tipo_pedido: string,
    public readonly estado: string,
    public readonly total: string,
    public readonly items: Array<{
      id_detalle: string;
      id_producto: string;
      nombre_producto: string;
      cantidad: number;
      notas_preparacion: string | null;
      modificadores: unknown;
    }>,
    public readonly fecha_creacion: Date,
  ) {}
}