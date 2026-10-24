import { Body, Controller, Get, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common'
import type { Request, Response } from 'express'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { Public } from '../../common/decorators/public.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import type { AuthUser } from '../../common/interfaces/auth-user.interface'
import { M5Service } from './m5.service'
import { StatisticsService } from './statistics.service'

@Controller('node')
export class NodeReportController {
  constructor(private readonly service: M5Service) {}
  @Public() @Post('report-traffic')
  reportTraffic(@Req() req: Request, @Body() body: unknown) { return this.service.reportTraffic(req.headers, req.ip ?? '', body) }
  @Public() @Post('report-logs')
  reportLogs(@Req() req: Request, @Body() body: unknown) { return this.service.reportLogs(req.headers, req.ip ?? '', body) }
}

@ApiTags('使用者端 - M5 統計與日誌')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('user')
export class M5Controller {
  constructor(private readonly service: M5Service, private readonly statistics: StatisticsService) {}
  @Get('statistics/export') @RequirePermissions('statistics:export')
  async exportStatistics(@CurrentUser() user: AuthUser,@Query() query:Record<string,unknown>,@Res() res:Response) { const text=await this.service.statisticsCsv(user.id,query);res.type('text/csv; charset=utf-8').setHeader('Content-Disposition','attachment; filename="statistics.csv"').send(text) }
  @Get('statistics/:report') @RequirePermissions('statistics:read')
  report(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>, @Req() req: Request) {
    const report = String(req.params.report)
    if (report === 'traffic') return this.statistics.traffic(user.id, query)
    if (!['traffic','bandwidth','requests','hitrate','region','isp','status-code','top-url','top-ip'].includes(report)) return this.service.stat(user.id,'invalid',query)
    return this.service.stat(user.id, report, query)
  }
  @Get('logs/access') @RequirePermissions('log:read')
  access(@CurrentUser() user: AuthUser,@Query() query: Record<string,unknown>) { return this.service.accessLogs(user.id,query) }
  @Get('logs/access/export') @RequirePermissions('log:export')
  async exportLogs(@CurrentUser() user: AuthUser,@Query() query: Record<string,unknown>,@Res() res:Response) { const text=await this.service.exportLogs(user.id,query);res.type('text/csv; charset=utf-8').setHeader('Content-Disposition','attachment; filename="access-logs.csv"').send(text) }
  @Get('logs/delivery') @RequirePermissions('log:read')
  deliveryGet(@CurrentUser() user:AuthUser,@Query('domainId') domainId:string) { return this.service.delivery(user.id,domainId) }
  @Put('logs/delivery') @RequirePermissions('log:read')
  deliveryPut(@CurrentUser() user:AuthUser,@Query('domainId') domainId:string,@Body() body:unknown) { return this.service.delivery(user.id,domainId,body) }
}
