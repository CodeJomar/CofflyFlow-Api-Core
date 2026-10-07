import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardFiltroDto } from './dto/dashboard-filtro.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CheckStatus } from '../../core/dto/check-status.dto';
import { MensajeQuery } from '../../core/dto/mensaje-query.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * Resumen analítico integral para dueños y administradores
   */
  @Get('resumen')
  @Roles('OWNER')
  async obtenerResumen(@Query() filtro: DashboardFiltroDto): Promise<CheckStatus<unknown>> {
    const data = await this.dashboardService.obtenerMetricasConsolidadas(filtro);
    return new CheckStatus(
      'OK',
      [new MensajeQuery('DASH_200', 'Métricas consolidadas recuperadas con éxito.')],
      '',
      data,
    );
  }
}