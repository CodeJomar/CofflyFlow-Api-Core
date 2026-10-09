import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginationQueryDto } from '../../core/dto/pagination-query.dto';
import { DateUtils } from '../../core/utils/date.utils';
import { UsersRepository, type UsuarioSeguro } from './users.repository';

export type { UsuarioSeguro } from './users.repository';

/** Reglas de negocio de usuarios. El acceso a datos (y el cifrado de DNI y teléfono) vive en UsersRepository. */
@Injectable()
export class UsersService {
  private readonly saltRounds: number;

  constructor(
    private readonly repo: UsersRepository,
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
    const cargo = await this.repo.buscarCargoVigente(dto.id_rol);
    if (!cargo) throw new BadRequestException('El cargo asignado no existe o ha sido eliminado.');

    const emailNormalizado = dto.email.toLowerCase().trim();
    if (await this.repo.existeEmail(emailNormalizado)) {
      throw new ConflictException('Ya existe un usuario registrado con este correo electrónico.');
    }

    // Contraseña inutilizable hasta la activación (la columna es NOT NULL)
    const passwordHash = await this.hashPassword(randomBytes(32).toString('hex'));

    const nuevo = await this.repo.insertar({
      id_rol: dto.id_rol,
      email: emailNormalizado,
      password_hash: passwordHash,
      nombre: dto.nombre.trim(),
      dni: dto.dni,
      telefono: dto.telefono,
      // La fecha de ingreso la fija el sistema al registrar al empleado (hoy, hora de Lima)
      fecha_ingreso: dto.fecha_ingreso ?? DateUtils.formatearSoloFecha(),
      usuario_creacion: idUsuarioCreador,
    });

    return { ...nuevo, rol_nombre: cargo.nombre };
  }

  /** Lista usuarios paginados (para panel de administración). */
  async listarUsuarios(query: PaginationQueryDto): Promise<{ items: UsuarioSeguro[]; total: number }> {
    const pagina = Math.max(1, Number(query.pagina) || 1);
    const limite = Math.min(100, Math.max(1, Number(query.limite) || 10));
    return this.repo.listar(query.busqueda, limite, (pagina - 1) * limite);
  }

  /** Obtiene un usuario seguro por su ID. */
  async obtenerPorId(idUsuario: string): Promise<UsuarioSeguro> {
    const usuario = await this.repo.obtener(idUsuario);
    if (!usuario) throw new NotFoundException('El usuario solicitado no existe o ha sido dado de baja.');
    return usuario;
  }

  /** Actualiza los datos de un usuario. La contraseña NO se cambia aquí: solo por activación o recuperación. */
  async actualizarUsuario(idUsuario: string, dto: UpdateUserDto, idUsuarioEditor?: string): Promise<UsuarioSeguro> {
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
      if (!(await this.repo.buscarCargoVigente(dto.id_rol))) throw new BadRequestException('El cargo asignado no existe.');
      camposActualizar.id_rol = dto.id_rol;
    }

    if (dto.email) {
      const emailLower = dto.email.toLowerCase().trim();
      if (await this.repo.existeEmail(emailLower, idUsuario)) throw new ConflictException('El correo ya está en uso por otro empleado.');
      camposActualizar.email = emailLower;
    }

    await this.repo.actualizar(idUsuario, camposActualizar);

    // Una cuenta que deja de estar activa pierde sus sesiones de inmediato.
    if (dto.estado && dto.estado !== 'activo') {
      await this.revocarSesiones(idUsuario, 'cuenta_deshabilitada');
    }

    return this.obtenerPorId(idUsuario);
  }

  /** Eliminación lógica (soft-delete). El historial de pedidos, auditoría y transacciones se conserva. */
  async eliminarUsuario(idUsuario: string, idUsuarioEditor?: string, motivo?: string): Promise<void> {
    const actual = await this.obtenerPorId(idUsuario);

    if (actual.tipo_cuenta === 'OWNER') throw new ForbiddenException('Una cuenta OWNER no se puede dar de baja.');
    if (idUsuario === idUsuarioEditor) throw new ForbiddenException('No puedes darte de baja a ti mismo.');

    await this.repo.darDeBaja(idUsuario, motivo?.trim() || null, idUsuarioEditor);
    await this.revocarSesiones(idUsuario, 'baja_usuario');
  }

  /** Cargos operativos vigentes (WAITER, BARISTA, CASHIER, OPERATOR). */
  listarCargos(): Promise<{ id_rol: string; nombre: string; descripcion: string | null }[]> {
    return this.repo.listarCargos();
  }

  /** Revoca todas las sesiones vigentes de un usuario. */
  revocarSesiones(idUsuario: string, motivo: string): Promise<void> {
    return this.repo.revocarSesiones(idUsuario, motivo);
  }

  // =========================================================================
  // MÉTODOS DE SERVICIO INTERNO (CONSUMIDOS EXCLUSIVAMENTE POR AUTHMODULE)
  // =========================================================================

  /** Busca un usuario no eliminado por correo (incluye password_hash y cargo; OWNER puede no tener cargo). */
  buscarPorEmailParaAuth(email: string) {
    return this.repo.buscarPorEmailParaAuth(email.toLowerCase().trim());
  }

  /** Busca un usuario no eliminado por id para los flujos de Auth. */
  buscarPorIdParaAuth(idUsuario: string) {
    return this.repo.buscarPorIdParaAuth(idUsuario);
  }

  registrarFalloLogin(idUsuario: string, maxIntentos: number, minutosBloqueo: number): Promise<void> {
    return this.repo.registrarFalloLogin(idUsuario, maxIntentos, minutosBloqueo);
  }

  resetearFallosLogin(idUsuario: string): Promise<void> {
    return this.repo.resetearFallosLogin(idUsuario);
  }
}
