/** Datos del usuario autenticado. Los tokens viajan únicamente en cookies HttpOnly. */
export class SesionUsuarioData {
  id_usuario: string;
  nombre: string;
  email: string;
  tipo_cuenta: string;
  id_rol: string | null;
  rol_nombre: string | null;
}

export class LoginResponseData {
  usuario: SesionUsuarioData;
  expira_en_segundos: number;
}

export class TokenRestablecimientoData {
  token_restablecimiento: string;
  expira_en_segundos: number;
}
