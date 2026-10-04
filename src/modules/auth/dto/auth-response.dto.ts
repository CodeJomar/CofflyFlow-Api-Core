export class AuthResponseData {
  token_acceso: string;
  token_refresco: string;
  tipo_token: string;
  expira_en_segundos: number;
  usuario: {
    id_usuario: string;
    nombre: string;
    email: string;
    id_rol: string;
    rol_nombre: string;
  };
}