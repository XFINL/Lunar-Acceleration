import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { RoleType } from '@lunar/shared'
import { Roles } from '../../common/decorators/roles.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { RolesGuard } from '../../common/guards/roles.guard'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { paginate } from '../../common/dto/response.dto'
import { DomainService } from './domain.service'
import { AuditDomainDto, DomainListQueryDto } from './dto/domain.dto'
@ApiTags('管理端 - 域名审核') @ApiBearerAuth() @UseGuards(RolesGuard,PermissionsGuard) @Roles(RoleType.ADMIN,RoleType.SUPER_ADMIN) @Controller('admin/domains')
export class DomainAuditController {
 constructor(private readonly service:DomainService){}
 @Get() @RequirePermissions('domain:read') async list(@Query() q:DomainListQueryDto){const r=await this.service.adminList(q);return paginate(r.list,q.page,q.pageSize,r.total)}
 @Post(':id/audit') @RequirePermissions('domain:audit') audit(@Param('id') id:string,@Body() dto:AuditDomainDto){return this.service.audit(id,dto.approve,dto.remark)}
 @Post(':id/approve') @RequirePermissions('domain:audit') approve(@Param('id') id:string){return this.service.audit(id,true)}
 @Post(':id/reject') @RequirePermissions('domain:audit') reject(@Param('id') id:string,@Body() dto:AuditDomainDto){return this.service.audit(id,false,dto.remark)}
}
