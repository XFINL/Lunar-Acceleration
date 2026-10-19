import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { paginate } from '../../common/dto/response.dto'
import type { AuthUser } from '../../common/interfaces/auth-user.interface'
import { DomainService } from './domain.service'
import { BatchDomainDto, CreateDomainDto, DomainListQueryDto, UpdateDomainDto } from './dto/domain.dto'
@ApiTags('用户端 - 域名') @ApiBearerAuth() @UseGuards(PermissionsGuard) @Controller('user/domains')
export class DomainController {
  constructor(private readonly service: DomainService) {}
  @Get() @RequirePermissions('domain:read') @ApiOperation({ summary: '分页查询我的域名' }) async list(@CurrentUser() u: AuthUser, @Query() q: DomainListQueryDto) { const r=await this.service.list(u.id,q); return paginate(r.list,q.page,q.pageSize,r.total) }
  @Post() @RequirePermissions('domain:create') @ApiOperation({ summary: '创建域名（待审核）' }) create(@CurrentUser() u: AuthUser,@Body() dto:CreateDomainDto){return this.service.create(u.id,dto)}
  @Post('batch') @ApiOperation({ summary: '批量删除、停用或检查域名；逐项返回结果' }) batch(@CurrentUser() u:AuthUser,@Body() dto:BatchDomainDto){return this.service.batch(u.id,dto,u.permissions,u.roleType)}
  @Get(':id') @RequirePermissions('domain:read') get(@CurrentUser() u:AuthUser,@Param('id') id:string){return this.service.get(u.id,id)}
  @Put(':id') @RequirePermissions('domain:update') update(@CurrentUser() u:AuthUser,@Param('id') id:string,@Body() dto:UpdateDomainDto){return this.service.update(u.id,id,dto)}
  @Delete(':id') @RequirePermissions('domain:delete') remove(@CurrentUser() u:AuthUser,@Param('id') id:string){return this.service.remove(u.id,id)}
  @Post(':id/check') @RequirePermissions('domain:read') @ApiOperation({ summary:'检查 DNS CNAME（只做解析观察，不启用）' }) check(@CurrentUser() u:AuthUser,@Param('id') id:string){return this.service.checkDns(u.id,id)}
  @Post(':id/dns-check') @RequirePermissions('domain:read') @ApiOperation({ summary:'兼容旧版DNS检测路径' }) checkLegacy(@CurrentUser() u:AuthUser,@Param('id') id:string){return this.service.checkDns(u.id,id)}
  @Post(':id/enable') @RequirePermissions('domain:update') @ApiOperation({ summary:'启用域名；真实部署未实现，接口明确返回不可用' }) enable(@CurrentUser() u:AuthUser,@Param('id') id:string){return this.service.setEnabled(u.id,id,true)}
  @Post(':id/disable') @RequirePermissions('domain:update') disable(@CurrentUser() u:AuthUser,@Param('id') id:string){return this.service.setEnabled(u.id,id,false)}
}
