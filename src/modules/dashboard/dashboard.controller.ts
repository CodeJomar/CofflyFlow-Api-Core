import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { UsuarioAutenticado } from '../auth/session.service';
import { DashboardService } from './dashboard.service';
import { DashboardFiltroDto } from './dto/dashboard-filtro.dto';
import { RequirePermission } from '../../common/decorators/roles.decorator';
import { MODULO, ACCION } from '../../common/security/permission-matrix';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Resumen analítico integral para dueños y administradores
   */
  @Get('resumen')
  @RequirePermission(MODULO.DASHBOARD, ACCION.LEER)
  async obtenerResumen(@Query() filtro: DashboardFiltroDto, @CurrentUser() usuario: UsuarioAutenticado): Promise<CheckStatus<unknown>> {
    const data = await this.dashboardService.obtenerMetricasConsolidadas(filtro, usuario);
    return new CheckStatus(
      'OK',
      [new MensajeQuery('DASH_200', 'Métricas consolidadas recuperadas con éxito.')],
      '',
      data,
    );
  }
}