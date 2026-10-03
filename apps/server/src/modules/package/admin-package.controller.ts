import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { RoleType } from '@lunar/shared'
import { Type } from 'class-transformer'
import {
  Allow,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator'
import { Auditable } from '../../common/decorators/audit.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { paginate } from '../../common/dto/response.dto'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { PackageService } from './package.service'

class AdminPackageQueryDto extends PaginationQueryDto {}

class CreatePackageDto {
  @ApiPropertyOptional({ description: '套餐名称' })
  @IsString()
  @Length(1, 64)
  name!: string

  @ApiPropertyOptional({ description: '套餐标识（唯一）' })
  @IsString()
  @Length(1, 64)
  code!: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(512)
  @IsOptional()
  description?: string

  @ApiPropertyOptional({ description: '1自建节点 2第三方厂商 3混合' })
  @Type(() => Number)
  @IsInt()
  accessType!: number

  @ApiPropertyOptional({ description: '厂商 ID' })
  @IsString()
  @IsOptional()
  vendorId?: string

  @ApiPropertyOptional({ description: '流量额度(字节)' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  trafficQuota?: number

  @ApiPropertyOptional({ description: '带宽上限(Kbps)' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  bandwidthLimit?: number

  @ApiPropertyOptional({ description: '域名数限制' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  domainLimit?: number

  @ApiPropertyOptional({ description: '请求数额度' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  requestQuota?: number

  @ApiPropertyOptional({ description: '功能开关（任意 JSON）', type: Object })
  @Allow()
  @IsOptional()
  featureFlags?: unknown

  @ApiPropertyOptional({ description: '1限速 2按量扣费 3停服' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  overQuotaPolicy?: number

  @ApiPropertyOptional({ description: '价格' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  price?: number

  @ApiPropertyOptional({ description: '1月 2季 3年' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  period?: number

  @ApiPropertyOptional({ description: '0下架 1上架' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  status?: number

  @ApiPropertyOptional({ description: '排序' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  sort?: number
}

class UpdatePackageDto {
  @ApiPropertyOptional()
  @IsString()
  @Length(1, 64)
  @IsOptional()
  name?: string

  @ApiPropertyOptional()
  @IsString()
  @Length(1, 64)
  @IsOptional()
  code?: string

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(512)
  @IsOptional()
  description?: string

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  accessType?: number

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  vendorId?: string

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  trafficQuota?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  bandwidthLimit?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  domainLimit?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  requestQuota?: number

  @ApiPropertyOptional({ type: Object })
  @Allow()
  @IsOptional()
  featureFlags?: unknown

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  overQuotaPolicy?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  price?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  period?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  status?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  sort?: number
}

class UpdatePackageStatusDto {
  @ApiPropertyOptional({ description: '0下架 1上架' })
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1])
  status!: number
}

class AssignPackageDto {
  @ApiPropertyOptional({ description: '套餐 ID' })
  @IsString()
  packageId!: string

  @ApiPropertyOptional({ description: '周期 1月 2季 3年，不传取套餐默认' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  period?: number
}

@ApiTags('管理员端 - 套餐')
@ApiBearerAuth()
@Controller('admin/packages')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(RoleType.ADMIN, RoleType.SUPER_ADMIN)
export class AdminPackageController {
  constructor(private readonly packageService: PackageService) {}

  @Get()
  @RequirePermissions('package:read')
  @ApiOperation({ summary: '套餐列表' })
  async list(@Query() query: AdminPackageQueryDto) {
    const { total, list } = await this.packageService.adminList({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      status: query.status,
    })
    return paginate(list, query.page, query.pageSize, total)
  }

  @Post()
  @RequirePermissions('package:create')
  @Auditable({ module: 'package', action: 'create_package', targetType: 'package' })
  @ApiOperation({ summary: '创建套餐' })
  async create(@Body() dto: CreatePackageDto) {
    return this.packageService.adminCreatePackage(dto)
  }

  @Get(':id')
  @RequirePermissions('package:read')
  @ApiOperation({ summary: '套餐详情' })
  async detail(@Param('id') id: string) {
    return this.packageService.adminGetPackage(id)
  }

  @Put(':id')
  @RequirePermissions('package:update')
  @Auditable({ module: 'package', action: 'update_package', targetType: 'package' })
  @ApiOperation({ summary: '更新套餐' })
  async update(@Param('id') id: string, @Body() dto: UpdatePackageDto) {
    return this.packageService.adminUpdatePackage(id, dto)
  }

  @Delete(':id')
  @RequirePermissions('package:delete')
  @Auditable({ module: 'package', action: 'delete_package', targetType: 'package' })
  @ApiOperation({ summary: '删除套餐' })
  async remove(@Param('id') id: string) {
    return this.packageService.adminDeletePackage(id)
  }

  @Put(':id/status')
  @RequirePermissions('package:update')
  @Auditable({ module: 'package', action: 'update_package_status', targetType: 'package' })
  @ApiOperation({ summary: '上下架套餐' })
  async setStatus(@Param('id') id: string, @Body() dto: UpdatePackageStatusDto) {
    return this.packageService.adminSetStatus(id, dto.status)
  }
}

@ApiTags('管理员端 - 用户套餐')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(RoleType.ADMIN, RoleType.SUPER_ADMIN)
export class AdminUserPackageController {
  constructor(private readonly packageService: PackageService) {}

  @Post(':id/package')
  @RequirePermissions('user:update')
  @Auditable({ module: 'package', action: 'assign_package', targetType: 'user' })
  @ApiOperation({ summary: '为用户分配套餐' })
  async assign(@Param('id') id: string, @Body() dto: AssignPackageDto) {
    return this.packageService.assignPackage(id, dto.packageId, dto.period)
  }
}
