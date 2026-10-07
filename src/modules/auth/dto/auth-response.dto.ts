/**
 * Datos del usuario autenticado que se devuelven al cliente. Es una lista BLANCA: ningún identificador interno
 * (ni el UUID del usuario ni el del cargo). Los tokens viajan únicamente en cookies HttpOnly.
 */
export class SesionUsuarioData {
  nombre: string;
  email: string;
  tipo_cuenta: string;
  rol_nombre: string | null;
  /**
   * Permisos efectivos ("MODULO:ACCION") para que la interfaz oculte lo que no puede usar. OWNER recibe ["*"].
   * Es solo ayuda de UX: la autorización real se vuelve a comprobar en el servidor en cada petición.
   */
  permisos: string[];
}

export class LoginResponseData {
  usuario: SesionUsuarioData;
  expira_en_segundos: number;
}

export class TokenRestablecimientoData {
  token_restablecimiento: string;
  expira_en_segundos: number;
}
