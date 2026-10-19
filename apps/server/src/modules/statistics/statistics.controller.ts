import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import type { AuthUser } from '../../common/interfaces/auth-user.interface'
import { StatisticsService, type TrafficStatisticsQuery } from './statistics.service'

@ApiTags('使用者端 - 統計')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('user/statistics')
export class StatisticsController {
  constructor(private readonly service: StatisticsService) {}

  @Get('traffic')
  @RequirePermissions('statistics:read')
  @ApiOperation({ summary: '查詢已觀測到的域名流量統計' })
  traffic(@CurrentUser() user: AuthUser, @Query() query: TrafficStatisticsQuery) {
    return this.service.traffic(user.id, query)
  }
}
