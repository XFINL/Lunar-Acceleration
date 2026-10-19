import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import type { AuthUser } from '../../common/interfaces/auth-user.interface'
import { DomainResourceService } from './domain-resource.service'

@ApiTags('用户端 - 域名缓存与源站')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('user/domains/:id')
export class DomainResourceController {
  constructor(private readonly resources: DomainResourceService) {}

  @Get('cache-rules')
  @RequirePermissions('cache:read')
  @ApiOperation({ summary: '查询域名缓存规则' })
  listCacheRules(@CurrentUser() user: AuthUser, @Param('id') domainId: string) {
    return this.resources.listCacheRules(user.id, domainId)
  }

  @Post('cache-rules')
  @RequirePermissions('cache:create')
  @ApiOperation({ summary: '创建缓存规则；配置已保存但尚未生效' })
  createCacheRule(@CurrentUser() user: AuthUser, @Param('id') domainId: string, @Body() body: unknown) {
    return this.resources.createCacheRule(user.id, domainId, body)
  }

  // Keep the literal sort path before the parameterized ruleId route.
  @Put('cache-rules/sort')
  @RequirePermissions('cache:update')
  @ApiOperation({ summary: '按完整规则集合调整优先级（数字越小越先）' })
  sortCacheRules(@CurrentUser() user: AuthUser, @Param('id') domainId: string, @Body() body: unknown) {
    return this.resources.sortCacheRules(user.id, domainId, body)
  }

  @Put('cache-rules/:ruleId')
  @RequirePermissions('cache:update')
  @ApiOperation({ summary: '更新缓存规则；配置已保存但尚未生效' })
  updateCacheRule(@CurrentUser() user: AuthUser, @Param('id') domainId: string, @Param('ruleId') ruleId: string, @Body() body: unknown) {
    return this.resources.updateCacheRule(user.id, domainId, ruleId, body)
  }

  @Delete('cache-rules/:ruleId')
  @RequirePermissions('cache:delete')
  @ApiOperation({ summary: '删除缓存规则' })
  deleteCacheRule(@CurrentUser() user: AuthUser, @Param('id') domainId: string, @Param('ruleId') ruleId: string) {
    return this.resources.deleteCacheRule(user.id, domainId, ruleId)
  }

  @Get('origins')
  @RequirePermissions('origin:read')
  @ApiOperation({ summary: '查询源站组与源站' })
  listOrigins(@CurrentUser() user: AuthUser, @Param('id') domainId: string) {
    return this.resources.listOrigins(user.id, domainId)
  }

  @Post('origins')
  @RequirePermissions('origin:create')
  @ApiOperation({ summary: '原子创建源站组及源站；配置已保存但尚未生效' })
  createOriginGroup(@CurrentUser() user: AuthUser, @Param('id') domainId: string, @Body() body: unknown) {
    return this.resources.createOriginGroup(user.id, domainId, body)
  }

  @Post('origins/health-check')
  @RequirePermissions('origin:update')
  @ApiOperation({ summary: '对本域名下已保存源站执行有界安全健康检查；仅返回状态码、延迟及安全错误码' })
  healthCheck(@CurrentUser() user: AuthUser, @Param('id') domainId: string, @Body() body: unknown) {
    return this.resources.healthCheck(user.id, domainId, body)
  }

  @Put('origins/:originId')
  @RequirePermissions('origin:update')
  @ApiOperation({ summary: '更新源站；配置已保存但尚未生效' })
  updateOrigin(@CurrentUser() user: AuthUser, @Param('id') domainId: string, @Param('originId') originId: string, @Body() body: unknown) {
    return this.resources.updateOrigin(user.id, domainId, originId, body)
  }

  @Delete('origins/:originId')
  @RequirePermissions('origin:delete')
  @ApiOperation({ summary: '删除源站' })
  deleteOrigin(@CurrentUser() user: AuthUser, @Param('id') domainId: string, @Param('originId') originId: string) {
    return this.resources.deleteOrigin(user.id, domainId, originId)
  }


  @Post('origin-groups/:groupId/origins')
  @RequirePermissions('origin:create')
  @ApiOperation({ summary: '向已有源站组新增源站；请求体为 {origins:[源站配置...]}' })
  addOriginsToGroup(@CurrentUser() user: AuthUser, @Param('id') domainId: string, @Param('groupId') groupId: string, @Body() body: unknown) {
    return this.resources.addOriginsToGroup(user.id, domainId, groupId, body)
  }

  @Delete('origin-groups/:groupId')
  @RequirePermissions('origin:delete')
  @ApiOperation({ summary: '删除源站组及其源站' })
  deleteOriginGroup(@CurrentUser() user: AuthUser, @Param('id') domainId: string, @Param('groupId') groupId: string) {
    return this.resources.deleteOriginGroup(user.id, domainId, groupId)
  }

  @Put('origin-groups/:groupId')
  @RequirePermissions('origin:update')
  @ApiOperation({ summary: '更新源站组；配置已保存但尚未生效' })
  updateOriginGroup(@CurrentUser() user: AuthUser, @Param('id') domainId: string, @Param('groupId') groupId: string, @Body() body: unknown) {
    return this.resources.updateOriginGroup(user.id, domainId, groupId, body)
  }
}
