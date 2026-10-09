import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, ne, sql } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseData, SesionUsuarioData, TokenRestablecimientoData } from './dto/auth-response.dto';
import { TokensSesion } from './auth-cookies';
import type { UsuarioAutenticado } from './session.service';
import { CambiarPasswordDto, ActualizarPerfilDto } from './dto/profile.dto';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { codigos_verificacion, sesiones_usuario, usuarios } from '../../common/database/schema/users.schema';
import { AuditLoggerService } from '../../common/audit/audit-logger.service';
import { MailService } from '../../common/mail/mail.service';
import { PermissionsService } from '../../common/security/permissions.service';
import { LoginAttemptsService } from './login-attempts.service';
import { TooManyAttemptsException } from './too-many-attempts.exception';
import { DateUtils } from '../../core/utils/date.utils';
import { duracionASegundos } from '../../core/utils/duration.util';

export interface ContextoPeticion {
  ip: string | null;
  userAgent: string | null;
}

export interface ResultadoSesion {
  respuesta: LoginResponseData;
  tokens: TokensSesion;
}

const TIPO_ACTIVACION = 'activacion_cuenta';
const TIPO_OTP = 'recuperacion_password';
const TIPO_RESTABLECER = 'restablecer_password';

const HORAS_ACTIVACION = 48;
const MINUTOS_RESTABLECER = 10;
const SEGUNDOS_COOLDOWN_OTP = 60;
const GRACIA_ROTACION_MS = 10_000;
const MENSAJE_CREDENCIALES = 'Credenciales inválidas.';

/** Solo se muestran cuando la contraseña es correcta: quien llega aquí ya es dueño de la cuenta, así que no se filtra nada. */
const MENSAJE_CUENTA_NO_ACTIVA: Record<string, string> = {
  suspendido: 'Tu cuenta está suspendida. Contacta al administrador.',
  pendiente_activacion: 'Tu cuenta aún no está activada. Usa el enlace del correo de activación o pide que te lo reenvíen.',
  inactivo: 'Tu cuenta fue dada de baja. Contacta al administrador.',
};
const MENSAJE_CODIGO = 'El código es inválido o ha expirado.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly hashFicticio: string;
  private readonly accesoSegundos: number;
  private readonly refrescoSegundos: number;
  private readonly sesionMaxSegundos: number;
  private readonly otpMinutos: number;
  private readonly otpMaxIntentos: number;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditLoggerService,
    private readonly mail: MailService,
    private readonly intentosLogin: LoginAttemptsService,
    private readonly permisos: PermissionsService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {
    const rondas = Number(this.config.get('BCRYPT_SALT_ROUNDS')) || 12;
    // Hash de relleno: se compara cuando el correo no existe para igualar el tiempo de respuesta.
    this.hashFicticio = bcrypt.hashSync(randomUUID(), rondas);
    this.accesoSegundos = duracionASegundos(this.config.get<string>('JWT_EXPIRATION'), 900);
    this.refrescoSegundos = duracionASegundos(this.config.get<string>('JWT_REFRESH_EXPIRATION'), 7 * 86400);
    this.sesionMaxSegundos = (Number(this.config.get('SESSION_MAX_HOURS')) || 12) * 3600;
    this.otpMinutos = Number(this.config.get('OTP_EXPIRATION_MINUTES')) || 10;
    this.otpMaxIntentos = Number(this.config.get('OTP_MAX_ATTEMPTS')) || 5;
  }

  // ===========================================================================
  // LOGIN / SESIÓN
  // ===========================================================================

  async login(dto: LoginDto, ctx: ContextoPeticion): Promise<ResultadoSesion> {
    const clave = dto.email.toLowerCase().trim();

    // Bloqueo temporal por exceso de intentos (aplica igual a correos existentes e inexistentes).
    const segundosBloqueo = await this.intentosLogin.segundosBloqueo(clave);
    if (segundosBloqueo > 0) {
      this.audit.registrarEvento({
        evento: 'LOGIN_BLOQUEADO',
        nivel_severidad: 'WARN',
        ip: ctx.ip,
        user_agent: ctx.userAgent,
      });
      throw new TooManyAttemptsException(segundosBloqueo);
    }

    const usuario = await this.usersService.buscarPorEmailParaAuth(dto.email);

    // bcrypt se ejecuta siempre, exista o no el usuario.
    const passwordValido = await bcrypt.compare(dto.password, usuario?.password_hash ?? this.hashFicticio);

    const ahora = new Date();
    const bloqueoBd =
      usuario?.estado === 'bloqueado' && usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > ahora
        ? Math.ceil((new Date(usuario.bloqueado_hasta).getTime() - ahora.getTime()) / 1000)
        : 0;
    const bloqueoManual = usuario?.estado === 'bloqueado' && !usuario.bloqueado_hasta;
    const estadoHabilitado = usuario?.estado === 'activo' || usuario?.estado === 'bloqueado';

    if (bloqueoBd > 0) {
      // Bloqueo persistente (p. ej. tras reiniciar el servidor): mismo 429 que el contador en memoria.
      throw new TooManyAttemptsException(bloqueoBd);
    }

    if (usuario && passwordValido && !estadoHabilitado) {
      // Contraseña correcta pero cuenta sin acceso: mensaje claro y sin sumar intentos fallidos.
      this.audit.registrarEvento({
        id_usuario: usuario.id_usuario,
        evento: 'LOGIN_CUENTA_NO_ACTIVA',
        nivel_severidad: 'WARN',
        ip: ctx.ip,
        user_agent: ctx.userAgent,
        detalles: { estado: usuario.estado },
      });
      throw new ForbiddenException(MENSAJE_CUENTA_NO_ACTIVA[usuario.estado] ?? 'Tu cuenta no tiene acceso. Contacta al administrador.');
    }

    if (!usuario || !passwordValido || bloqueoManual || !estadoHabilitado) {
      // Causa real solo en auditoría interna; hacia el cliente siempre el mismo mensaje.
      const motivo = !usuario
        ? 'usuario_inexistente'
        : bloqueoManual
          ? 'cuenta_bloqueada'
          : !estadoHabilitado
            ? `estado_${usuario.estado}`
            : 'password_incorrecta';

      if (usuario && !passwordValido && estadoHabilitado && !bloqueoManual) {
        const maxIntentos = Number(this.config.get('MAX_LOGIN_ATTEMPTS')) || 5;
        const minutosBloqueo = Number(this.config.get('ACCOUNT_LOCKOUT_MINUTES')) || 1;
        await this.usersService.registrarFalloLogin(usuario.id_usuario, maxIntentos, minutosBloqueo);
      }

      this.audit.registrarEvento({
        id_usuario: usuario?.id_usuario ?? null,
        evento: 'LOGIN_FALLIDO',
        nivel_severidad: 'WARN',
        ip: ctx.ip,
        user_agent: ctx.userAgent,
        detalles: { motivo },
      });

      const fallo = await this.intentosLogin.registrarFallo(clave);
      if (fallo.bloqueadoSegundos > 0) {
        throw new TooManyAttemptsException(fallo.bloqueadoSegundos);
      }
      throw new HttpException(
        { message: MENSAJE_CREDENCIALES, intentos_restantes: fallo.intentosRestantes },
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.intentosLogin.limpiar(clave);
    await this.usersService.resetearFallosLogin(usuario.id_usuario);

    const tokens = await this.emitirSesion(usuario.id_usuario, ctx, randomUUID());

    this.audit.registrarEvento({ id_usuario: usuario.id_usuario, evento: 'LOGIN_OK', ip: ctx.ip, user_agent: ctx.userAgent });

    return { respuesta: await this.armarRespuesta(usuario, tokens), tokens };
  }

  /** Rota el refresh token: el usado queda revocado y se emite uno nuevo de la misma familia. */
  async refrescar(refrescoCrudo: string | undefined, ctx: ContextoPeticion): Promise<ResultadoSesion> {
    if (!refrescoCrudo) throw new UnauthorizedException('Sesión no válida.');

    const hash = this.sha256(refrescoCrudo);
    const [sesion] = await this.db.select().from(sesiones_usuario).where(eq(sesiones_usuario.refresh_token_hash, hash)).limit(1);

    if (!sesion) throw new UnauthorizedException('Sesión no válida.');

    if (sesion.revocado) {
      const reciente =
        sesion.motivo_revocacion === 'rotacion' &&
        sesion.revocado_el &&
        Date.now() - new Date(sesion.revocado_el).getTime() < GRACIA_ROTACION_MS;

      // Dentro de la ventana de gracia es una carrera legítima (dos pestañas); fuera de ella es reuso malicioso.
      if (!reciente && sesion.familia_token) {
        await this.db
          .update(sesiones_usuario)
          .set({ revocado: true, revocado_el: DateUtils.ahoraUtc(), motivo_revocacion: 'sospecha_reuso' })
          .where(and(eq(sesiones_usuario.familia_token, sesion.familia_token), eq(sesiones_usuario.revocado, false)));
        this.audit.registrarEvento({
          id_usuario: sesion.id_usuario,
          evento: 'REFRESH_REUSO',
          nivel_severidad: 'CRITICAL',
          ip: ctx.ip,
          user_agent: ctx.userAgent,
        });
      }
      throw new UnauthorizedException('Sesión no válida.');
    }

    if (new Date(sesion.expira_en) <= new Date()) throw new UnauthorizedException('Sesión no válida.');

    const usuario = await this.usersService.buscarPorIdParaAuth(sesion.id_usuario);
    if (!usuario || usuario.estado !== 'activo') {
      await this.usersService.revocarSesiones(sesion.id_usuario, 'cuenta_deshabilitada');
      throw new UnauthorizedException('Sesión no válida.');
    }

    // Revocación atómica: si otra petición ya rotó este token, no se emite uno nuevo.
    const revocadas = await this.db
      .update(sesiones_usuario)
      .set({ revocado: true, revocado_el: DateUtils.ahoraUtc(), motivo_revocacion: 'rotacion' })
      .where(and(eq(sesiones_usuario.id_sesion, sesion.id_sesion), eq(sesiones_usuario.revocado, false)))
      .returning({ id: sesiones_usuario.id_sesion });
    if (revocadas.length === 0) throw new UnauthorizedException('Sesión no válida.');

    // El tope absoluto se cuenta desde el inicio de la sesión (el primer token de la familia), no desde cada renovación.
    const [{ inicio }] = await this.db
      .select({ inicio: sql<Date>`min(${sesiones_usuario.fecha_creacion})` })
      .from(sesiones_usuario)
      .where(eq(sesiones_usuario.familia_token, sesion.familia_token ?? sesion.id_sesion));
    const tokens = await this.emitirSesion(usuario.id_usuario, ctx, sesion.familia_token ?? randomUUID(), inicio ? new Date(inicio) : new Date());
    return { respuesta: await this.armarRespuesta(usuario, tokens), tokens };
  }

  async cerrarSesion(refrescoCrudo: string | undefined, ctx: ContextoPeticion): Promise<void> {
    if (!refrescoCrudo) return;
    const revocadas = await this.db
      .update(sesiones_usuario)
      .set({ revocado: true, revocado_el: DateUtils.ahoraUtc(), motivo_revocacion: 'logout' })
      .where(and(eq(sesiones_usuario.refresh_token_hash, this.sha256(refrescoCrudo)), eq(sesiones_usuario.revocado, false)))
      .returning({ id_usuario: sesiones_usuario.id_usuario });

    if (revocadas[0]) {
      this.audit.registrarEvento({ id_usuario: revocadas[0].id_usuario, evento: 'LOGOUT', ip: ctx.ip, user_agent: ctx.userAgent });
    }
  }

  async obtenerPerfil(idUsuario: string): Promise<SesionUsuarioData> {
    const usuario = await this.usersService.buscarPorIdParaAuth(idUsuario);
    if (!usuario) throw new UnauthorizedException('Sesión no válida.');
    return this.armarUsuario(usuario);
  }

  /** Perfil propio: solo el nombre para mostrar. El correo y el cargo los administra quien gestiona usuarios. */
  async actualizarPerfil(usuario: UsuarioAutenticado, dto: ActualizarPerfilDto, ctx: ContextoPeticion): Promise<SesionUsuarioData> {
    const anterior = usuario.nombre;
    await this.db
      .update(usuarios)
      .set({ nombre: dto.nombre, fecha_edicion: DateUtils.ahoraUtc(), usuario_edicion: usuario.id_usuario })
      .where(and(eq(usuarios.id_usuario, usuario.id_usuario), eq(usuarios.eliminado, false)));

    this.audit.registrarEvento({
      id_usuario: usuario.id_usuario,
      evento: 'PERFIL_ACTUALIZADO',
      ip: ctx.ip,
      user_agent: ctx.userAgent,
      detalles: { nombre_anterior: anterior, nombre_nuevo: dto.nombre },
    });
    return this.obtenerPerfil(usuario.id_usuario);
  }

  /**
   * Cambio de contraseña con sesión iniciada. Salvaguardas: (1) exige la contraseña actual, con el mismo freno de
   * intentos que el login (una sesión robada no sirve para adivinarla); (2) la nueva no puede ser igual; (3) se cierran
   * todas las demás sesiones y se conserva la actual; (4) se avisa por correo y se audita.
   */
  async cambiarPassword(usuario: UsuarioAutenticado, dto: CambiarPasswordDto, ctx: ContextoPeticion): Promise<void> {
    const clave = 'cambio-password:' + usuario.id_usuario;
    const segundos = await this.intentosLogin.segundosBloqueo(clave);
    if (segundos > 0) throw new TooManyAttemptsException(segundos);

    const registro = await this.usersService.buscarPorIdParaAuth(usuario.id_usuario);
    if (!registro?.password_hash) throw new UnauthorizedException('Sesión no válida.');

    if (!(await bcrypt.compare(dto.password_actual, registro.password_hash))) {
      this.audit.registrarEvento({
        id_usuario: usuario.id_usuario,
        evento: 'PASSWORD_CAMBIO_FALLIDO',
        nivel_severidad: 'WARN',
        ip: ctx.ip,
        user_agent: ctx.userAgent,
      });
      const fallo = await this.intentosLogin.registrarFallo(clave);
      if (fallo.bloqueadoSegundos > 0) throw new TooManyAttemptsException(fallo.bloqueadoSegundos);
      throw new HttpException(
        { message: 'La contraseña actual no es correcta.', intentos_restantes: fallo.intentosRestantes },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.password_actual === dto.password_nueva) {
      throw new BadRequestException('La contraseña nueva debe ser distinta de la actual.');
    }

    const ahora = DateUtils.ahoraUtc();
    await this.db
      .update(usuarios)
      .set({
        password_hash: await this.usersService.hashPassword(dto.password_nueva),
        ultimo_cambio_password: ahora,
        fecha_edicion: ahora,
        usuario_edicion: usuario.id_usuario,
      })
      .where(and(eq(usuarios.id_usuario, usuario.id_usuario), eq(usuarios.eliminado, false)));

    // Se cierran las demás sesiones (otros dispositivos); la actual sigue abierta.
    await this.db
      .update(sesiones_usuario)
      .set({ revocado: true, revocado_el: ahora, motivo_revocacion: 'cambio_password' })
      .where(
        and(
          eq(sesiones_usuario.id_usuario, usuario.id_usuario),
          eq(sesiones_usuario.revocado, false),
          ne(sesiones_usuario.id_sesion, usuario.sid),
        ),
      );
    await this.intentosLogin.limpiar(clave);

    this.audit.registrarEvento({
      id_usuario: usuario.id_usuario,
      evento: 'PASSWORD_CAMBIADA',
      nivel_severidad: 'WARN',
      ip: ctx.ip,
      user_agent: ctx.userAgent,
    });

    // El aviso es informativo: si el correo falla, el cambio ya está hecho.
    this.mail.enviarAvisoPasswordCambiada(registro.email, registro.nombre, DateUtils.formatearFechaHora(ahora)).catch(() => undefined);
  }

  // ===========================================================================
  // ACTIVACIÓN DE CUENTA (AUTH-003 a AUTH-005)
  // ===========================================================================

  /** Genera el enlace de un solo uso y lo envía por correo. Reemplaza cualquier activación pendiente. */
  async enviarActivacion(idUsuario: string, ctx: ContextoPeticion, idOperador?: string): Promise<void> {
    const usuario = await this.usersService.buscarPorIdParaAuth(idUsuario);
    if (!usuario || usuario.estado !== 'pendiente_activacion') {
      throw new BadRequestException('La cuenta no está pendiente de activación.');
    }

    await this.invalidarCodigos(usuario.id_usuario, TIPO_ACTIVACION);
    const token = randomBytes(32).toString('base64url');
    await this.guardarCodigo(usuario.id_usuario, TIPO_ACTIVACION, this.sha256(token), HORAS_ACTIVACION * 60, 1, ctx, idOperador);

    const base = (this.config.get<string>('WEB_URL') || 'http://localhost:3000').replace(/\/$/, '');
    const enlace = `${base}/activar-cuenta?token=${encodeURIComponent(token)}`;
    await this.mail.enviarActivacion(usuario.email, usuario.nombre, enlace, HORAS_ACTIVACION);
  }

  /** Comprueba (sin consumirlo) que el enlace de activación sirve; permite a la pantalla avisar de inmediato si venció. */
  async validarActivacion(token: string): Promise<{ nombre: string }> {
    const [fila] = await this.db
      .select({ nombre: usuarios.nombre })
      .from(codigos_verificacion)
      .innerJoin(usuarios, eq(usuarios.id_usuario, codigos_verificacion.id_usuario))
      .where(
        and(
          eq(codigos_verificacion.tipo, TIPO_ACTIVACION),
          eq(codigos_verificacion.codigo_hash, this.sha256(token)),
          eq(codigos_verificacion.usado, false),
          eq(codigos_verificacion.eliminado, false),
          gt(codigos_verificacion.expira_en, sql`now()`),
          eq(usuarios.estado, 'pendiente_activacion'),
          eq(usuarios.eliminado, false),
        ),
      )
      .limit(1);

    if (!fila) throw new BadRequestException('El enlace de activación es inválido o ha expirado.');
    return fila;
  }

  async activarCuenta(token: string, password: string, ctx: ContextoPeticion): Promise<void> {
    const consumido = await this.consumirCodigo(TIPO_ACTIVACION, this.sha256(token));
    if (!consumido) throw new BadRequestException('El enlace de activación es inválido o ha expirado.');

    const usuario = await this.usersService.buscarPorIdParaAuth(consumido.id_usuario);
    if (!usuario || usuario.estado !== 'pendiente_activacion') {
      throw new BadRequestException('El enlace de activación es inválido o ha expirado.');
    }

    const ahora = DateUtils.ahoraUtc();
    await this.db
      .update(usuarios)
      .set({
        password_hash: await this.usersService.hashPassword(password),
        estado: 'activo',
        email_verificado: true,
        email_verificado_el: ahora,
        ultimo_cambio_password: ahora,
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        fecha_edicion: ahora,
      })
      .where(eq(usuarios.id_usuario, usuario.id_usuario));

    this.audit.registrarEvento({ id_usuario: usuario.id_usuario, evento: 'CUENTA_ACTIVADA', ip: ctx.ip, user_agent: ctx.userAgent });
  }

  // ===========================================================================
  // RECUPERACIÓN DE CONTRASEÑA (AUTH-006 a AUTH-008)
  // ===========================================================================

  /**
   * Responde de inmediato y sin distinguir si el correo existe (AUTH-008): el trabajo real
   * (consulta, OTP, correo) se hace en segundo plano.
   */
  solicitarRecuperacion(email: string, ctx: ContextoPeticion): void {
    void this.procesarSolicitudRecuperacion(email, ctx).catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Fallo al procesar recuperación de contraseña: ${err.message}`);
    });
  }

  private async procesarSolicitudRecuperacion(email: string, ctx: ContextoPeticion): Promise<void> {
    const usuario = await this.usersService.buscarPorEmailParaAuth(email);
    const habilitado = usuario && (usuario.estado === 'activo' || usuario.estado === 'bloqueado');

    this.audit.registrarEvento({
      id_usuario: usuario?.id_usuario ?? null,
      evento: 'OTP_SOLICITADO',
      ip: ctx.ip,
      user_agent: ctx.userAgent,
      detalles: { elegible: Boolean(habilitado) },
    });
    if (!usuario || !habilitado) return;

    // Cooldown: no se emite un OTP nuevo si ya se envió uno hace menos de un minuto.
    const [reciente] = await this.db
      .select({ id: codigos_verificacion.id_codigo })
      .from(codigos_verificacion)
      .where(
        and(
          eq(codigos_verificacion.id_usuario, usuario.id_usuario),
          eq(codigos_verificacion.tipo, TIPO_OTP),
          gt(codigos_verificacion.fecha_creacion, sql`now() - make_interval(secs => ${SEGUNDOS_COOLDOWN_OTP})`),
        ),
      )
      .limit(1);
    if (reciente) return;

    await this.invalidarCodigos(usuario.id_usuario, TIPO_OTP);
    const codigo = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.guardarCodigo(usuario.id_usuario, TIPO_OTP, this.firmarOtp(usuario.id_usuario, codigo), this.otpMinutos, this.otpMaxIntentos, ctx);
    await this.mail.enviarCodigoRecuperacion(usuario.email, usuario.nombre, codigo, this.otpMinutos);
  }

  /** Valida el OTP y, si es correcto, lo consume y entrega un token de un solo uso para fijar la nueva contraseña. */
  async verificarOtp(email: string, codigo: string, ctx: ContextoPeticion): Promise<TokenRestablecimientoData> {
    const usuario = await this.usersService.buscarPorEmailParaAuth(email);
    const habilitado = usuario && (usuario.estado === 'activo' || usuario.estado === 'bloqueado');

    if (!usuario || !habilitado) {
      this.firmarOtp(randomUUID(), codigo); // trabajo equivalente
      throw new BadRequestException(MENSAJE_CODIGO);
    }

    const [registro] = await this.db
      .select()
      .from(codigos_verificacion)
      .where(
        and(
          eq(codigos_verificacion.id_usuario, usuario.id_usuario),
          eq(codigos_verificacion.tipo, TIPO_OTP),
          eq(codigos_verificacion.usado, false),
          eq(codigos_verificacion.eliminado, false),
          gt(codigos_verificacion.expira_en, sql`now()`),
        ),
      )
      .orderBy(sql`${codigos_verificacion.fecha_creacion} DESC`)
      .limit(1);

    if (!registro) throw new BadRequestException(MENSAJE_CODIGO);

    // El intento se cuenta antes de comparar y de forma atómica; al agotarse el código ya no sirve.
    const contado = await this.db
      .update(codigos_verificacion)
      .set({ intentos: sql`${codigos_verificacion.intentos} + 1` })
      .where(and(eq(codigos_verificacion.id_codigo, registro.id_codigo), sql`${codigos_verificacion.intentos} < ${codigos_verificacion.max_intentos}`))
      .returning({ id: codigos_verificacion.id_codigo });
    if (contado.length === 0) throw new BadRequestException(MENSAJE_CODIGO);

    if (!this.compararSeguro(registro.codigo_hash, this.firmarOtp(usuario.id_usuario, codigo))) {
      this.audit.registrarEvento({
        id_usuario: usuario.id_usuario,
        evento: 'OTP_FALLIDO',
        nivel_severidad: 'WARN',
        ip: ctx.ip,
        user_agent: ctx.userAgent,
      });
      throw new BadRequestException(MENSAJE_CODIGO);
    }

    // Consumo atómico del OTP (una sola validación exitosa).
    const consumido = await this.db
      .update(codigos_verificacion)
      .set({ usado: true, usado_el: DateUtils.ahoraUtc() })
      .where(and(eq(codigos_verificacion.id_codigo, registro.id_codigo), eq(codigos_verificacion.usado, false)))
      .returning({ id: codigos_verificacion.id_codigo });
    if (consumido.length === 0) throw new BadRequestException(MENSAJE_CODIGO);

    const token = randomBytes(32).toString('base64url');
    await this.invalidarCodigos(usuario.id_usuario, TIPO_RESTABLECER);
    await this.guardarCodigo(usuario.id_usuario, TIPO_RESTABLECER, this.sha256(token), MINUTOS_RESTABLECER, 1, ctx);

    return { token_restablecimiento: token, expira_en_segundos: MINUTOS_RESTABLECER * 60 };
  }

  async restablecerPassword(token: string, nuevaPassword: string, ctx: ContextoPeticion): Promise<void> {
    const consumido = await this.consumirCodigo(TIPO_RESTABLECER, this.sha256(token));
    if (!consumido) throw new BadRequestException('El token de restablecimiento es inválido o ha expirado.');

    const ahora = DateUtils.ahoraUtc();
    await this.db
      .update(usuarios)
      .set({
        password_hash: await this.usersService.hashPassword(nuevaPassword),
        ultimo_cambio_password: ahora,
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        estado: sql`CASE WHEN ${usuarios.estado} = 'bloqueado' THEN 'activo' ELSE ${usuarios.estado} END`,
        fecha_edicion: ahora,
      })
      .where(and(eq(usuarios.id_usuario, consumido.id_usuario), eq(usuarios.eliminado, false)));

    // Política: al cambiar la contraseña se cierran todas las sesiones del usuario.
    await this.usersService.revocarSesiones(consumido.id_usuario, 'reset_password');

    this.audit.registrarEvento({
      id_usuario: consumido.id_usuario,
      evento: 'PASSWORD_RESET',
      nivel_severidad: 'WARN',
      ip: ctx.ip,
      user_agent: ctx.userAgent,
    });
  }

  // ===========================================================================
  // UTILIDADES INTERNAS
  // ===========================================================================

  private async emitirSesion(idUsuario: string, ctx: ContextoPeticion, familia: string, inicioSesion = new Date()): Promise<TokensSesion> {
    const refrescoCrudo = randomBytes(48).toString('base64url');
    // La sesión nunca dura más que el tope absoluto (SESSION_MAX_HOURS, 12 h por defecto) desde que se inició sesión.
    const limite = inicioSesion.getTime() + this.sesionMaxSegundos * 1000;
    const expira = new Date(Math.min(Date.now() + this.refrescoSegundos * 1000, limite));
    const refrescoSegundos = Math.max(1, Math.floor((expira.getTime() - Date.now()) / 1000));

    const [sesion] = await this.db
      .insert(sesiones_usuario)
      .values({
        id_usuario: idUsuario,
        refresh_token_hash: this.sha256(refrescoCrudo),
        familia_token: familia,
        expira_en: expira,
        ip_origen: ctx.ip,
        user_agent: ctx.userAgent,
        nombre_dispositivo: 'Web / POS Terminal',
      })
      .returning({ id_sesion: sesiones_usuario.id_sesion });

    // Claims mínimos: la identidad, el cargo y el estado se leen de la base en cada petición.
    const acceso = this.jwtService.sign({ sub: idUsuario, sid: sesion.id_sesion });

    return { acceso, refresco: refrescoCrudo, accesoSegundos: this.accesoSegundos, refrescoSegundos };
  }

  /** Lista blanca: nunca se devuelven identificadores internos (UUID de usuario o de cargo). */
  private async armarUsuario(usuario: {
    nombre: string;
    email: string;
    tipo_cuenta: string;
    id_rol: string | null;
    rol_nombre: string | null;
  }): Promise<SesionUsuarioData> {
    const permisos =
      usuario.tipo_cuenta === 'OWNER' ? ['*'] : usuario.id_rol ? [...(await this.permisos.permisosDe(usuario.id_rol))].sort() : [];
    return {
      nombre: usuario.nombre,
      email: usuario.email,
      tipo_cuenta: usuario.tipo_cuenta,
      rol_nombre: usuario.rol_nombre,
      permisos,
    };
  }

  private async armarRespuesta(usuario: Parameters<AuthService['armarUsuario']>[0], tokens: TokensSesion): Promise<LoginResponseData> {
    return { usuario: await this.armarUsuario(usuario), expira_en_segundos: tokens.accesoSegundos };
  }

  private async guardarCodigo(
    idUsuario: string,
    tipo: string,
    codigoHash: string,
    minutosValidez: number,
    maxIntentos: number,
    ctx: ContextoPeticion,
    idOperador?: string,
  ): Promise<void> {
    await this.db.insert(codigos_verificacion).values({
      id_usuario: idUsuario,
      tipo,
      codigo_hash: codigoHash,
      expira_en: new Date(Date.now() + minutosValidez * 60_000),
      max_intentos: maxIntentos,
      ip_solicitud: ctx.ip,
      user_agent_solicitud: ctx.userAgent,
      usuario_creacion: idOperador ?? null,
    });
  }

  /** Marca como usados los códigos pendientes del usuario y tipo (solo uno vigente a la vez). */
  private async invalidarCodigos(idUsuario: string, tipo: string): Promise<void> {
    await this.db
      .update(codigos_verificacion)
      .set({ usado: true, usado_el: DateUtils.ahoraUtc() })
      .where(and(eq(codigos_verificacion.id_usuario, idUsuario), eq(codigos_verificacion.tipo, tipo), eq(codigos_verificacion.usado, false)));
  }

  /** Consume de forma atómica un token vigente y devuelve su usuario; null si no existe, venció o ya se usó. */
  private async consumirCodigo(tipo: string, codigoHash: string): Promise<{ id_usuario: string } | null> {
    const [fila] = await this.db
      .update(codigos_verificacion)
      .set({ usado: true, usado_el: DateUtils.ahoraUtc() })
      .where(
        and(
          eq(codigos_verificacion.tipo, tipo),
          eq(codigos_verificacion.codigo_hash, codigoHash),
          eq(codigos_verificacion.usado, false),
          eq(codigos_verificacion.eliminado, false),
          gt(codigos_verificacion.expira_en, sql`now()`),
        ),
      )
      .returning({ id_usuario: codigos_verificacion.id_usuario });
    return fila ?? null;
  }

  private sha256(valor: string): string {
    return createHash('sha256').update(valor).digest('hex');
  }

  /** HMAC del OTP con secreto del servidor: un volcado de la BD no permite recorrer el espacio de 10^6 códigos. */
  private firmarOtp(idUsuario: string, codigo: string): string {
    const secreto = this.config.get<string>('OTP_HMAC_SECRET');
    if (!secreto) throw new Error('OTP_HMAC_SECRET no está definido en las variables de entorno.');
    return createHmac('sha256', secreto).update(`${idUsuario}:${codigo}`).digest('hex');
  }

  private compararSeguro(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}
