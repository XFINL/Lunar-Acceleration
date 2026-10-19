import { Allow, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { RoleType } from '@lunar/shared'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { paginate } from '../../common/dto/response.dto'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { VendorService } from './vendor.service'

class VendorListQuery extends PaginationQueryDto {}
class AccountListQuery extends PaginationQueryDto {
  @ApiPropertyOptional() @IsString() @IsOptional() vendorId?: string
}
class CreateVendorDto {
  @IsString() @Length(1, 64) name!: string
  @IsString() @IsIn(['cloudflare', 'ali']) code!: 'cloudflare' | 'ali'
  @IsString() @Length(0, 512) @IsOptional() description?: string
  @Type(() => Number) @IsInt() @Min(0) @Max(1) @IsOptional() status?: number
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() sort?: number
}
class UpdateVendorDto {
  @IsString() @Length(1, 64) @IsOptional() name?: string
  @IsString() @Length(0, 512) @IsOptional() description?: string | null
  @Type(() => Number) @IsInt() @Min(0) @Max(1) @IsOptional() status?: number
  @Type(() => Number) @IsInt() @Min(0) @IsOptional() sort?: number
}
class CreateAccountDto {
  @IsString() vendorId!: string
  @IsString() @Length(1, 64) name!: string
  @IsString() @Length(1, 4096) accessKey!: string
  @IsString() @Length(0, 4096) @IsOptional() secretKey?: string
  @Allow() @IsOptional() config?: unknown
  @Type(() => Number) @IsInt() @Min(0) @Max(1) @IsOptional() status?: number
}
class UpdateAccountDto {
  @IsString() @IsOptional() vendorId?: string
  @IsString() @Length(1, 64) @IsOptional() name?: string
  @IsString() @Length(0, 4096) @IsOptional() accessKey?: string
  @IsString() @Length(0, 4096) @IsOptional() secretKey?: string
  @Allow() @IsOptional() config?: unknown
  @Type(() => Number) @IsInt() @Min(0) @Max(1) @IsOptional() status?: number
}

@ApiTags('管理员端 - 厂商只读连接')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(RoleType.ADMIN, RoleType.SUPER_ADMIN)
export class VendorController {
  constructor(private readonly service: VendorService) {}

  @Get('vendors') @RequirePermissions('vendor:read')
  async vendors(@Query() q: VendorListQuery) { const r = await this.service.listVendors(q); return paginate(r.list, q.page, q.pageSize, r.total) }
  @Post('vendors') @RequirePermissions('vendor:create') createVendor(@Body() dto: CreateVendorDto) { return this.service.createVendor(dto) }
  @Put('vendors/:id') @RequirePermissions('vendor:update') updateVendor(@Param('id') id: string, @Body() dto: UpdateVendorDto) { return this.service.updateVendor(id, dto) }
  @Delete('vendors/:id') @RequirePermissions('vendor:delete') deleteVendor(@Param('id') id: string) { return this.service.deleteVendor(id) }

  @Get('vendor-accounts') @RequirePermissions('vendor:read')
  async accounts(@Query() q: AccountListQuery) { const r = await this.service.listAccounts(q); return paginate(r.list, q.page, q.pageSize, r.total) }
  @Post('vendor-accounts') @RequirePermissions('vendor:create') createAccount(@Body() dto: CreateAccountDto) { return this.service.createAccount(dto) }
  @Put('vendor-accounts/:id') @RequirePermissions('vendor:update') updateAccount(@Param('id') id: string, @Body() dto: UpdateAccountDto) { return this.service.updateAccount(id, dto) }
  @Delete('vendor-accounts/:id') @RequirePermissions('vendor:delete') deleteAccount(@Param('id') id: string) { return this.service.deleteAccount(id) }
  @Get('vendor-accounts/:id/logs') @RequirePermissions('vendor:read')
  async logs(@Param('id') id: string, @Query() q: PaginationQueryDto) { const r = await this.service.listLogs(id, q); return paginate(r.list, q.page, q.pageSize, r.total) }
  @Get('vendor-accounts/:id/resources') @RequirePermissions('vendor:read')
  async resources(@Param('id') id: string, @Query() q: PaginationQueryDto) { const r = await this.service.listResources(id, q); return paginate(r.list, q.page, q.pageSize, r.total) }
  @Post('vendor-accounts/:id/test') @RequirePermissions('vendor:test') test(@Param('id') id: string) { return this.service.testAccount(id) }
  @Post('vendor-accounts/:id/sync') @RequirePermissions('vendor:sync') sync(@Param('id') id: string) { return this.service.syncAccount(id) }
}
