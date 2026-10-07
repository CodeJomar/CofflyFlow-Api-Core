import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { and, eq, inArray } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../database/database.provider';
import { acciones, modulos } from '../database/schema/users.schema';
import { PERMISSIONS_KEY, PermisoRequerido } from '../decorators/roles.decorator';
import { ETIQUETA_ACCION, ETIQUETA_MODULO, PERMISOS_DE_SERVICIO } from './permission-matrix';

export interface PermisoDescubierto {
  modulo: string;
  accion: string;
  /** Endpoints que exigen este permiso, p. ej. "POST /menu/productos". */
  endpoints: string[];
  /** Solo para permisos que se comprueban dentro de un servicio (sin endpoint propio). */
  regla_negocio?: string;
}

export interface CatalogoModulo {
  modulo: string;
  etiqueta: string;
  acciones: Array<{ accion: string; etiqueta: string; endpoints: string[]; regla_negocio?: string }>;
}

/**
 * Catálogo de permisos AUTODESCUBIERTO. El código es la fuente de qué permisos existen (cada endpoint declara el
 * suyo con @RequirePermission); al arrancar se leen todos los controladores y se registran en `modulos` y `acciones`
 * los que falten. Así, agregar un módulo o endpoint nuevo NO requiere editar listas ni volver a correr seeds:
 * basta el decorador. Solo AGREGA filas; nunca borra ni modifica las existentes. A qué cargo se concede cada
 * permiso es un dato (`rol_permisos`), administrable sin desplegar; por defecto solo OWNER tiene acceso.
 */
@Injectable()
export class PermissionCatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionCatalogService.name);

  constructor(
    private readonly discovery: DiscoveryService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.sincronizar();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      // No impide arrancar: sin catálogo nuevo, los endpoints siguen protegidos (solo OWNER los usa).
      this.logger.error(`No se pudo sincronizar el catálogo de permisos: ${err.message}`);
    }
  }

  /** Permisos declarados en los controladores, con los endpoints que los exigen. */
  descubrir(): PermisoDescubierto[] {
    const mapa = new Map<string, PermisoDescubierto>();

    for (const wrapper of this.discovery.getControllers()) {
      const instancia = wrapper.instance as Record<string, unknown> | undefined;
      if (!instancia) continue;
      const prototipo = Object.getPrototypeOf(instancia) as Record<string, unknown>;
      const prefijo = (Reflect.getMetadata('path', wrapper.metatype as object) as string | undefined) ?? '';
      const permisoClase = Reflect.getMetadata(PERMISSIONS_KEY, wrapper.metatype as object) as PermisoRequerido | undefined;

      for (const nombre of Object.getOwnPropertyNames(prototipo)) {
        const manejador = prototipo[nombre];
        if (typeof manejador !== 'function' || nombre === 'constructor') continue;
        const permiso = (Reflect.getMetadata(PERMISSIONS_KEY, manejador) as PermisoRequerido | undefined) ?? permisoClase;
        if (!permiso) continue;

        const metodoHttp = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'][Reflect.getMetadata('method', manejador) as number];
        const ruta = (Reflect.getMetadata('path', manejador) as string | undefined) ?? '';
        const endpoint = `${metodoHttp ?? '?'} /${[prefijo, ruta === '/' ? '' : ruta].filter(Boolean).join('/')}`;

        const clave = `${permiso.modulo}:${permiso.accion}`;
        const actual = mapa.get(clave) ?? { modulo: permiso.modulo, accion: permiso.accion, endpoints: [] };
        actual.endpoints.push(endpoint);
        mapa.set(clave, actual);
      }
    }
    for (const p of PERMISOS_DE_SERVICIO) {
      const clave = `${p.modulo}:${p.accion}`;
      const actual = mapa.get(clave) ?? { modulo: p.modulo, accion: p.accion, endpoints: [] };
      actual.regla_negocio = p.descripcion;
      mapa.set(clave, actual);
    }
    return [...mapa.values()].sort((a, b) => `${a.modulo}:${a.accion}`.localeCompare(`${b.modulo}:${b.accion}`));
  }

  /** Catálogo agrupado por módulo, con etiquetas legibles, listo para pintar la pantalla de permisos. */
  catalogoAgrupado(): CatalogoModulo[] {
    const porModulo = new Map<string, CatalogoModulo>();
    for (const p of this.descubrir()) {
      const grupo = porModulo.get(p.modulo) ?? { modulo: p.modulo, etiqueta: ETIQUETA_MODULO[p.modulo] ?? p.modulo, acciones: [] };
      grupo.acciones.push({
        accion: p.accion,
        etiqueta: ETIQUETA_ACCION[p.accion] ?? p.accion,
        endpoints: p.endpoints,
        ...(p.regla_negocio ? { regla_negocio: p.regla_negocio } : {}),
      });
      porModulo.set(p.modulo, grupo);
    }
    return [...porModulo.values()];
  }

  /** ¿Existe este permiso en el catálogo del código? (para rechazar permisos inventados) */
  existe(modulo: string, accion: string): boolean {
    return this.descubrir().some((p) => p.modulo === modulo && p.accion === accion);
  }

  private async sincronizar(): Promise<void> {
    const descubiertos = this.descubrir();
    const modulosNecesarios = [...new Set(descubiertos.map((p) => p.modulo))];
    const accionesNecesarias = [...new Set(descubiertos.map((p) => p.accion))];
    if (modulosNecesarios.length === 0) return;
    this.logger.log(`Catálogo de permisos: ${descubiertos.length} permiso(s) en ${descubiertos.reduce((n, p) => n + p.endpoints.length, 0)} endpoint(s) (más reglas de negocio).`);

    const existentesModulos = new Set(
      (await this.db.select({ n: modulos.nombre }).from(modulos).where(and(inArray(modulos.nombre, modulosNecesarios), eq(modulos.eliminado, false)))).map((m) => m.n),
    );
    const existentesAcciones = new Set(
      (await this.db.select({ n: acciones.nombre }).from(acciones).where(and(inArray(acciones.nombre, accionesNecesarias), eq(acciones.eliminado, false)))).map((a) => a.n),
    );

    const modulosNuevos = modulosNecesarios.filter((m) => !existentesModulos.has(m));
    const accionesNuevas = accionesNecesarias.filter((a) => !existentesAcciones.has(a));

    if (modulosNuevos.length > 0) await this.db.insert(modulos).values(modulosNuevos.map((nombre) => ({ nombre })));
    if (accionesNuevas.length > 0) await this.db.insert(acciones).values(accionesNuevas.map((nombre) => ({ nombre })));

    if (modulosNuevos.length > 0 || accionesNuevas.length > 0) {
      this.logger.log(
        `Catálogo de permisos actualizado: módulos nuevos [${modulosNuevos.join(', ') || '-'}], acciones nuevas [${accionesNuevas.join(', ') || '-'}]. ` +
          'Asigna los permisos a los cargos que corresponda (por defecto solo OWNER los tiene).',
      );
    }
  }
}
