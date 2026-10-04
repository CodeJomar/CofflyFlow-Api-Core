import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, sql, desc, count } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { usuarios, roles } from '../../common/database/schema/users.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginationQueryDto } from '../../core/dto/pagination-query.dto';
import { DateUtils } from '../../core/utils/date.utils';

// Interfaz para la vista pública y segura del usuario (sin password_hash)
export interface UsuarioSeguro {
  id_usuario: string;
  id_rol: string;
  rol_nombre?: string | null;
  email: string;
  nombre: string;
  estado: string | null;
  email_verificado: boolean | null;
  ultimo_login: Date | null;
  fecha_creacion: Date | null;
  fecha_edicion: Date | null;
}

@Injectable()
export class UsersService {
  private readonly saltRounds: number;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly configService: ConfigService,
  ) {
    this.saltRounds = Number(this.configService.get('BCRYPT_SALT_ROUNDS')) || 12;
  }

  /**
   * Crea un nuevo empleado en el sistema
   */
  async crearUsuario(dto: CreateUserDto, idUsuarioCreador?: string): Promise<UsuarioSeguro> {
    // 1. Validar que el rol exista y no esté eliminado
    const rolExiste = await this.db
      .select({ id_rol: roles.id_rol, nombre: roles.nombre })
      .from(roles)
      .where(and(eq(roles.id_rol, dto.id_rol), eq(roles.eliminado, false)))
      .limit(1);

    if (rolExiste.length === 0) {
      throw new BadRequestException('El rol asignado no existe o ha sido eliminado.');
    }

    // 2. Validar duplicidad de email activo
    const emailExistente = await this.db
      .select({ id_usuario: usuarios.id_usuario })
      .from(usuarios)
      .where(and(eq(usuarios.email, dto.email.toLowerCase()), eq(usuarios.eliminado, false)))
      .limit(1);

    if (emailExistente.length > 0) {
      throw new ConflictException('Ya existe un usuario registrado con este correo electrónico.');
    }

    // 3. Hashear contraseña con bcrypt
    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);

    // 4. Insertar en base de datos
    const [nuevoUsuario] = await this.db
      .insert(usuarios)
      .values({
        id_rol: dto.id_rol,
        email: dto.email.toLowerCase().trim(),
        password_hash: passwordHash,
        nombre: dto.nombre.trim(),
        estado: dto.estado ?? 'activo',
        usuario_creacion: idUsuarioCreador ?? null,
        usuario_edicion: idUsuarioCreador ?? null,
      })
      .returning({
        id_usuario: usuarios.id_usuario,
        id_rol: usuarios.id_rol,
        email: usuarios.email,
        nombre: usuarios.nombre,
        estado: usuarios.estado,
        email_verificado: usuarios.email_verificado,
        ultimo_login: usuarios.ultimo_login,
        fecha_creacion: usuarios.fecha_creacion,
        fecha_edicion: usuarios.fecha_edicion,
      });

    return {
      ...nuevoUsuario,
      rol_nombre: rolExiste[0].nombre,
    };
  }

  /**
   * Lista usuarios paginados (para panel de administración)
   */
  async listarUsuarios(query: PaginationQueryDto): Promise<{ items: UsuarioSeguro[]; total: number }> {
    const pagina = Math.max(1, Number(query.pagina) || 1);
    const limite = Math.min(100, Math.max(1, Number(query.limite) || 10));
    const offset = (pagina - 1) * limite;

    const condiciones = [eq(usuarios.eliminado, false)];

    if (query.busqueda) {
      const termino = `%${query.busqueda.trim().toLowerCase()}%`;
      condiciones.push(
        sql`(LOWER(${usuarios.nombre}) LIKE ${termino} OR LOWER(${usuarios.email}) LIKE ${termino})`,
      );
    }

    const whereClause = and(...condiciones);

    // 1. Conteo total
    const [conteo] = await this.db
      .select({ total: count() })
      .from(usuarios)
      .where(whereClause);

    // 2. Consulta de registros con JOIN al rol
    const filas = await this.db
      .select({
        id_usuario: usuarios.id_usuario,
        id_rol: usuarios.id_rol,
        rol_nombre: roles.nombre,
        email: usuarios.email,
        nombre: usuarios.nombre,
        estado: usuarios.estado,
        email_verificado: usuarios.email_verificado,
        ultimo_login: usuarios.ultimo_login,
        fecha_creacion: usuarios.fecha_creacion,
        fecha_edicion: usuarios.fecha_edicion,
      })
      .from(usuarios)
      .leftJoin(roles, eq(usuarios.id_rol, roles.id_rol))
      .where(whereClause)
      .orderBy(desc(usuarios.fecha_creacion))
      .limit(limite)
      .offset(offset);

    return {
      items: filas,
      total: Number(conteo?.total || 0),
    };
  }

  /**
   * Obtiene un usuario seguro por su ID
   */
  async obtenerPorId(idUsuario: string): Promise<UsuarioSeguro> {
    const [usuario] = await this.db
      .select({
        id_usuario: usuarios.id_usuario,
        id_rol: usuarios.id_rol,
        rol_nombre: roles.nombre,
        email: usuarios.email,
        nombre: usuarios.nombre,
        estado: usuarios.estado,
        email_verificado: usuarios.email_verificado,
        ultimo_login: usuarios.ultimo_login,
        fecha_creacion: usuarios.fecha_creacion,
        fecha_edicion: usuarios.fecha_edicion,
      })
      .from(usuarios)
      .leftJoin(roles, eq(usuarios.id_rol, roles.id_rol))
      .where(and(eq(usuarios.id_usuario, idUsuario), eq(usuarios.eliminado, false)))
      .limit(1);

    if (!usuario) {
      throw new NotFoundException('El usuario solicitado no existe o ha sido dado de baja.');
    }

    return usuario;
  }

  /**
   * Actualiza los datos de un usuario
   */
  async actualizarUsuario(
    idUsuario: string,
    dto: UpdateUserDto,
    idUsuarioEditor?: string,
  ): Promise<UsuarioSeguro> {
    // Validar existencia previa
    await this.obtenerPorId(idUsuario);

    const camposActualizar: Record<string, unknown> = {
      fecha_edicion: DateUtils.ahoraUtc(),
      usuario_edicion: idUsuarioEditor ?? null,
    };

    if (dto.nombre) camposActualizar.nombre = dto.nombre.trim();
    if (dto.estado) camposActualizar.estado = dto.estado;

    if (dto.id_rol) {
      const [rol] = await this.db
        .select()
        .from(roles)
        .where(and(eq(roles.id_rol, dto.id_rol), eq(roles.eliminado, false)))
        .limit(1);

      if (!rol) throw new BadRequestException('El rol asignado no existe.');
      camposActualizar.id_rol = dto.id_rol;
    }

    if (dto.email) {
      const emailLower = dto.email.toLowerCase().trim();
      const [duplicado] = await this.db
        .select({ id: usuarios.id_usuario })
        .from(usuarios)
        .where(
          and(
            eq(usuarios.email, emailLower),
            sql`${usuarios.id_usuario} != ${idUsuario}`,
            eq(usuarios.eliminado, false),
          ),
        )
        .limit(1);

      if (duplicado) throw new ConflictException('El correo ya está en uso por otro empleado.');
      camposActualizar.email = emailLower;
    }

    if (dto.password) {
      camposActualizar.password_hash = await bcrypt.hash(dto.password, this.saltRounds);
      camposActualizar.ultimo_cambio_password = DateUtils.ahoraUtc();
    }

    await this.db
      .update(usuarios)
      .set(camposActualizar)
      .where(eq(usuarios.id_usuario, idUsuario));

    return this.obtenerPorId(idUsuario);
  }

  /**
   * Eliminación lógica (Soft-delete)
   */
  async eliminarUsuario(idUsuario: string, idUsuarioEditor?: string): Promise<void> {
    await this.obtenerPorId(idUsuario);

    await this.db
      .update(usuarios)
      .set({
        eliminado: true,
        estado: 'inactivo',
        fecha_edicion: DateUtils.ahoraUtc(),
        usuario_edicion: idUsuarioEditor ?? null,
      })
      .where(eq(usuarios.id_usuario, idUsuario));
  }

  // =========================================================================
  // MÉTODOS DE SERVICIO INTERNO (CONSUMIDOS EXCLUSIVAMENTE POR AUTHMODULE)
  // =========================================================================

  /**
   * Busca usuario completo para verificación de login (incluye password_hash y rol)
   */
  async buscarPorEmailParaAuth(email: string) {
    const [usuario] = await this.db
      .select({
        id_usuario: usuarios.id_usuario,
        id_rol: usuarios.id_rol,
        rol_nombre: roles.nombre,
        email: usuarios.email,
        password_hash: usuarios.password_hash,
        nombre: usuarios.nombre,
        estado: usuarios.estado,
        intentos_fallidos: usuarios.intentos_fallidos,
        bloqueado_hasta: usuarios.bloqueado_hasta,
      })
      .from(usuarios)
      .innerJoin(roles, eq(usuarios.id_rol, roles.id_rol))
      .where(and(eq(usuarios.email, email.toLowerCase().trim()), eq(usuarios.eliminado, false)))
      .limit(1);

    return usuario ?? null;
  }

  /**
   * Registra un fallo de login y aplica bloqueo temporal si excede el límite
   */
  async registrarFalloLogin(idUsuario: string, maxIntentos: number, minutosBloqueo: number): Promise<void> {
    const usuario = await this.db
      .select({ intentos: usuarios.intentos_fallidos })
      .from(usuarios)
      .where(eq(usuarios.id_usuario, idUsuario))
      .limit(1);

    const intentosActuales = (usuario[0]?.intentos || 0) + 1;
    const actualizacion: Record<string, unknown> = {
      intentos_fallidos: intentosActuales,
    };

    if (intentosActuales >= maxIntentos) {
      actualizacion.bloqueado_hasta = DateUtils.sumarMinutos(minutosBloqueo);
      actualizacion.estado = 'bloqueado';
    }

    await this.db.update(usuarios).set(actualizacion).where(eq(usuarios.id_usuario, idUsuario));
  }

  /**
   * Resetea el contador de fallos tras un login exitoso
   */
  async resetearFallosLogin(idUsuario: string): Promise<void> {
    await this.db
      .update(usuarios)
      .set({
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        ultimo_login: DateUtils.ahoraUtc(),
        estado: 'activo',
      })
      .where(eq(usuarios.id_usuario, idUsuario));
  }
}