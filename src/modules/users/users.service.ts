import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and, sql, desc, count } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { DRIZZLE, DrizzleDb } from '../../common/database/database.provider';
import { usuarios, roles, sesiones_usuario } from '../../common/database/schema/users.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginationQueryDto } from '../../core/dto/pagination-query.dto';
import { DateUtils } from '../../core/utils/date.utils';

// Interfaz para la vista pública y segura del usuario (sin password_hash)
export interface UsuarioSeguro {
  id_usuario: string;
  tipo_cuenta: string;
  id_rol: string | null;
  rol_nombre?: string | null;
  email: string;
  nombre: string;
  estado: string;
  email_verificado: boolean | null;
  ultimo_login: Date | null;
  dni: string | null;
  telefono: string | null;
  fecha_ingreso: string | null;
  fecha_baja: Date | null;
  motivo_baja: string | null;
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

  /** Hash bcrypt con el costo configurado (única política de hashing de contraseñas). */
  hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.saltRounds);
  }

  /**
   * Crea un empleado (tipo_cuenta EMPLOYEE) en estado pendiente de activación.
   * No recibe contraseña: el empleado la define al activar su cuenta desde el correo.
   */
  async crearUsuario(dto: CreateUserDto, idUsuarioCreador?: string): Promise<UsuarioSeguro> {
    // 1. Validar que el cargo exista y no esté eliminado
    const cargoExiste = await this.db
      .select({ id_rol: roles.id_rol, nombre: roles.nombre })
      .from(roles)
      .where(and(eq(roles.id_rol, dto.id_rol), eq(roles.eliminado, false)))
      .limit(1);

    if (cargoExiste.length === 0) {
      throw new BadRequestException('El cargo asignado no existe o ha sido eliminado.');
    }

    // 2. Validar duplicidad de email activo
    const emailNormalizado = dto.email.toLowerCase().trim();
    const emailExistente = await this.db
      .select({ id_usuario: usuarios.id_usuario })
      .from(usuarios)
      .where(and(eq(usuarios.email, emailNormalizado), eq(usuarios.eliminado, false)))
      .limit(1);

    if (emailExistente.length > 0) {
      throw new ConflictException('Ya existe un usuario registrado con este correo electrónico.');
    }

    // 3. Contraseña inutilizable hasta la activación (la columna es NOT NULL)
    const passwordHash = await this.hashPassword(randomBytes(32).toString('hex'));

    // 4. Insertar en base de datos
    const [nuevoUsuario] = await this.db
      .insert(usuarios)
      .values({
        tipo_cuenta: 'EMPLOYEE',
        id_rol: dto.id_rol,
        email: emailNormalizado,
        password_hash: passwordHash,
        nombre: dto.nombre.trim(),
        dni: dto.dni?.trim() || null,
        telefono: dto.telefono?.trim() || null,
        fecha_ingreso: dto.fecha_ingreso ?? null,
        estado: 'pendiente_activacion',
        usuario_creacion: idUsuarioCreador ?? null,
        usuario_edicion: idUsuarioCreador ?? null,
      })
      .returning({
        id_usuario: usuarios.id_usuario,
        tipo_cuenta: usuarios.tipo_cuenta,
        id_rol: usuarios.id_rol,
        email: usuarios.email,
        nombre: usuarios.nombre,
        estado: usuarios.estado,
        email_verificado: usuarios.email_verificado,
        ultimo_login: usuarios.ultimo_login,
        dni: usuarios.dni,
        telefono: usuarios.telefono,
        fecha_ingreso: usuarios.fecha_ingreso,
        fecha_baja: usuarios.fecha_baja,
        motivo_baja: usuarios.motivo_baja,
        fecha_creacion: usuarios.fecha_creacion,
        fecha_edicion: usuarios.fecha_edicion,
      });

    return {
      ...nuevoUsuario,
      rol_nombre: cargoExiste[0].nombre,
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
      tipo_cuenta: usuarios.tipo_cuenta,
      id_rol: usuarios.id_rol,
        rol_nombre: roles.nombre,
        email: usuarios.email,
        nombre: usuarios.nombre,
        estado: usuarios.estado,
        email_verificado: usuarios.email_verificado,
        ultimo_login: usuarios.ultimo_login,
        dni: usuarios.dni,
        telefono: usuarios.telefono,
        fecha_ingreso: usuarios.fecha_ingreso,
        fecha_baja: usuarios.fecha_baja,
        motivo_baja: usuarios.motivo_baja,
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
      tipo_cuenta: usuarios.tipo_cuenta,
      id_rol: usuarios.id_rol,
        rol_nombre: roles.nombre,
        email: usuarios.email,
        nombre: usuarios.nombre,
        estado: usuarios.estado,
        email_verificado: usuarios.email_verificado,
        ultimo_login: usuarios.ultimo_login,
        dni: usuarios.dni,
        telefono: usuarios.telefono,
        fecha_ingreso: usuarios.fecha_ingreso,
        fecha_baja: usuarios.fecha_baja,
        motivo_baja: usuarios.motivo_baja,
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
   * Actualiza los datos de un usuario. La contraseña NO se cambia aquí: solo por activación o recuperación.
   */
  async actualizarUsuario(
    idUsuario: string,
    dto: UpdateUserDto,
    idUsuarioEditor?: string,
  ): Promise<UsuarioSeguro> {
    const actual = await this.obtenerPorId(idUsuario);

    if (actual.tipo_cuenta === 'OWNER' && (dto.estado || dto.id_rol)) {
      throw new ForbiddenException('El estado y el cargo de una cuenta OWNER no se modifican desde aquí.');
    }
    if (idUsuario === idUsuarioEditor && dto.estado && dto.estado !== actual.estado) {
      throw new ForbiddenException('No puedes cambiar el estado de tu propia cuenta.');
    }
    if (dto.estado && actual.estado === 'pendiente_activacion') {
      throw new BadRequestException('La cuenta está pendiente de activación; el empleado debe activarla desde su correo.');
    }

    const camposActualizar: Record<string, unknown> = {
      fecha_edicion: DateUtils.ahoraUtc(),
      usuario_edicion: idUsuarioEditor ?? null,
    };

    if (dto.nombre) camposActualizar.nombre = dto.nombre.trim();
    if (dto.dni !== undefined) camposActualizar.dni = dto.dni.trim() || null;
    if (dto.telefono !== undefined) camposActualizar.telefono = dto.telefono.trim() || null;
    if (dto.fecha_ingreso !== undefined) camposActualizar.fecha_ingreso = dto.fecha_ingreso || null;
    if (dto.estado) camposActualizar.estado = dto.estado;

    if (dto.id_rol) {
      const [cargo] = await this.db
        .select()
        .from(roles)
        .where(and(eq(roles.id_rol, dto.id_rol), eq(roles.eliminado, false)))
        .limit(1);

      if (!cargo) throw new BadRequestException('El cargo asignado no existe.');
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

    await this.db
      .update(usuarios)
      .set(camposActualizar)
      .where(eq(usuarios.id_usuario, idUsuario));

    // Una cuenta que deja de estar activa pierde sus sesiones de inmediato.
    if (dto.estado && dto.estado !== 'activo') {
      await this.revocarSesiones(idUsuario, 'cuenta_deshabilitada');
    }

    return this.obtenerPorId(idUsuario);
  }

  /**
   * Eliminación lógica (Soft-delete). El historial de pedidos, auditoría y transacciones se conserva.
   */
  async eliminarUsuario(idUsuario: string, idUsuarioEditor?: string, motivo?: string): Promise<void> {
    const actual = await this.obtenerPorId(idUsuario);

    if (actual.tipo_cuenta === 'OWNER') {
      throw new ForbiddenException('Una cuenta OWNER no se puede dar de baja.');
    }
    if (idUsuario === idUsuarioEditor) {
      throw new ForbiddenException('No puedes darte de baja a ti mismo.');
    }

    await this.db
      .update(usuarios)
      .set({
        eliminado: true,
        estado: 'inactivo',
        fecha_baja: DateUtils.ahoraUtc(),
        motivo_baja: motivo?.trim() || null,
        fecha_edicion: DateUtils.ahoraUtc(),
        usuario_edicion: idUsuarioEditor ?? null,
      })
      .where(eq(usuarios.id_usuario, idUsuario));

    await this.revocarSesiones(idUsuario, 'baja_usuario');
  }

  /** Cargos operativos vigentes (WAITER, BARISTA, CASHIER, OPERATOR). */
  async listarCargos(): Promise<{ id_rol: string; nombre: string; descripcion: string | null }[]> {
    return this.db
      .select({ id_rol: roles.id_rol, nombre: roles.nombre, descripcion: roles.descripcion })
      .from(roles)
      .where(eq(roles.eliminado, false))
      .orderBy(roles.nombre);
  }

  /** Revoca todas las sesiones vigentes de un usuario. */
  async revocarSesiones(idUsuario: string, motivo: string): Promise<void> {
    await this.db
      .update(sesiones_usuario)
      .set({ revocado: true, revocado_el: DateUtils.ahoraUtc(), motivo_revocacion: motivo })
      .where(and(eq(sesiones_usuario.id_usuario, idUsuario), eq(sesiones_usuario.revocado, false)));
  }

  // =========================================================================
  // MÉTODOS DE SERVICIO INTERNO (CONSUMIDOS EXCLUSIVAMENTE POR AUTHMODULE)
  // =========================================================================

  private readonly camposAuth = {
    id_usuario: usuarios.id_usuario,
    tipo_cuenta: usuarios.tipo_cuenta,
    id_rol: usuarios.id_rol,
    rol_nombre: roles.nombre,
    email: usuarios.email,
    password_hash: usuarios.password_hash,
    nombre: usuarios.nombre,
    estado: usuarios.estado,
    intentos_fallidos: usuarios.intentos_fallidos,
    bloqueado_hasta: usuarios.bloqueado_hasta,
  };

  /** Busca un usuario no eliminado por correo (incluye password_hash y cargo; OWNER puede no tener cargo). */
  async buscarPorEmailParaAuth(email: string) {
    const [usuario] = await this.db
      .select(this.camposAuth)
      .from(usuarios)
      .leftJoin(roles, eq(usuarios.id_rol, roles.id_rol))
      .where(and(eq(usuarios.email, email.toLowerCase().trim()), eq(usuarios.eliminado, false)))
      .limit(1);

    return usuario ?? null;
  }

  /** Busca un usuario no eliminado por id para los flujos de Auth. */
  async buscarPorIdParaAuth(idUsuario: string) {
    const [usuario] = await this.db
      .select(this.camposAuth)
      .from(usuarios)
      .leftJoin(roles, eq(usuarios.id_rol, roles.id_rol))
      .where(and(eq(usuarios.id_usuario, idUsuario), eq(usuarios.eliminado, false)))
      .limit(1);

    return usuario ?? null;
  }

  /**
   * Registra un fallo de login de forma atómica (una sola sentencia con bloqueo de fila).
   * Si el bloqueo anterior ya venció, el contador reinicia en 1.
   */
  async registrarFalloLogin(idUsuario: string, maxIntentos: number, minutosBloqueo: number): Promise<void> {
    await this.db.execute(sql`
      UPDATE usuarios u SET
        intentos_fallidos = s.n,
        bloqueado_hasta = CASE WHEN s.n >= ${maxIntentos} THEN now() + make_interval(mins => ${minutosBloqueo}) ELSE NULL END,
        estado = CASE
          WHEN s.n >= ${maxIntentos} THEN 'bloqueado'
          WHEN u.estado = 'bloqueado' THEN 'activo'
          ELSE u.estado
        END
      FROM (
        SELECT id_usuario,
               CASE WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= now() THEN 1
                    ELSE COALESCE(intentos_fallidos, 0) + 1 END AS n
          FROM usuarios
         WHERE id_usuario = ${idUsuario}
           FOR UPDATE
      ) s
      WHERE u.id_usuario = s.id_usuario
    `);
  }

  /** Resetea el contador de fallos tras un login exitoso; solo levanta el estado 'bloqueado'. */
  async resetearFallosLogin(idUsuario: string): Promise<void> {
    await this.db
      .update(usuarios)
      .set({
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        ultimo_login: DateUtils.ahoraUtc(),
        estado: sql`CASE WHEN ${usuarios.estado} = 'bloqueado' THEN 'activo' ELSE ${usuarios.estado} END`,
      })
      .where(eq(usuarios.id_usuario, idUsuario));
  }
}
