export class UserResponseData {
  id_usuario: string;
  nombre: string;
  email: string;
  estado: string;
  email_verificado: boolean;
  id_rol: string;
  rol_nombre: string;
  ultimo_login?: string | null;
  fecha_creacion: string;
}