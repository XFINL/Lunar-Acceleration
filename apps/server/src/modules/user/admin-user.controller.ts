import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { RoleType, UserStatus } from '@lunar/shared'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
} from 'class-validator'
import { Auditable } from '../../common/decorators/audit.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { paginate } from '../../common/dto/response.dto'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import type { AuthUser } from '../../common/interfaces/auth-user.interface'
import { UserService } from './user.service'

class AdminUserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '角色类型 1用户 2管理员 3超管' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  roleType?: number
}

class AdminCreateUserDto {
  @IsString()
  @Length(3, 64)
  username!: string

  @IsString()
  @Length(8, 32)
  password!: string

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  nickname?: string

  @ApiPropertyOptional({ enum: RoleType })
  @IsEnum(RoleType)
  @IsOptional()
  roleType?: RoleType

  @ApiPropertyOptional({ description: '角色标识列表', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  roleCodes?: string[]
}

class AdminUpdateUserDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  nickname?: string

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string

  @ApiPropertyOptional({ enum: UserStatus })
  @IsInt()
  @IsOptional()
  status?: number

  @ApiPropertyOptional({ enum: RoleType })
  @IsEnum(RoleType)
  @IsOptional()
  roleType?: RoleType
}

class ResetPasswordDto {
  @ApiPropertyOptional({ description: '不传则随机生成并返回' })
  @IsString()
  @Length(8, 32)
  @IsOptional()
  password?: string
}

class AdjustBalanceDto {
  @ApiPropertyOptional({ description: '变动金额，正加负减' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  remark?: string
}

@ApiTags('管理员端 - 用户管理')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(RoleType.ADMIN, RoleType.SUPER_ADMIN)
export class AdminUserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @RequirePermissions('user:read')
  @ApiOperation({ summary: '用户列表' })
  async list(@Query() query: AdminUserQueryDto) {
    const { total, list } = await this.userService.adminList({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      status: query.status,
      roleType: query.roleType,
    })
    return paginate(list, query.page, query.pageSize, total)
  }

  @Post()
  @RequirePermissions('user:create')
  @Auditable({ module: 'user', action: 'create_user', targetType: 'user' })
  @ApiOperation({ summary: '创建用户' })
  async create(@Body() dto: AdminCreateUserDto) {
    return this.userService.adminCreateUser(dto)
  }

  @Get(':id')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: '用户详情' })
  async detail(@Param('id') id: string) {
    return this.userService.adminGetUser(id)
  }

  @Put(':id')
  @RequirePermissions('user:update')
  @Auditable({ module: 'user', action: 'update_user', targetType: 'user' })
  @ApiOperation({ summary: '更新用户' })
  async update(@Param('id') id: string, @Body() dto: AdminUpdateUserDto) {
    return this.userService.adminUpdateUser(id, dto)
  }

  @Delete(':id')
  @RequirePermissions('user:delete')
  @Auditable({ module: 'user', action: 'delete_user', targetType: 'user' })
  @ApiOperation({ summary: '删除用户（软删除）' })
  async remove(@Param('id') id: string) {
    return this.userService.adminDeleteUser(id)
  }

  @Post(':id/ban')
  @RequirePermissions('user:update')
  @Auditable({ module: 'user', action: 'ban_user', targetType: 'user' })
  @ApiOperation({ summary: '封禁用户' })
  async ban(@Param('id') id: string) {
    return this.userService.adminSetStatus(id, UserStatus.DISABLED)
  }

  @Post(':id/unban')
  @RequirePermissions('user:update')
  @Auditable({ module: 'user', action: 'unban_user', targetType: 'user' })
  @ApiOperation({ summary: '解封用户' })
  async unban(@Param('id') id: string) {
    return this.userService.adminSetStatus(id, UserStatus.ACTIVE)
  }

  @Post(':id/reset-password')
  @RequirePermissions('user:update')
  @Auditable({ module: 'user', action: 'reset_password', targetType: 'user' })
  @ApiOperation({ summary: '重置密码' })
  async resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    return this.userService.adminResetPassword(id, dto.password)
  }

  @Post(':id/balance')
  @RequirePermissions('user:update')
  @Auditable({ module: 'user', action: 'adjust_balance', targetType: 'user' })
  @ApiOperation({ summary: '调整余额' })
  async adjustBalance(
    @Param('id') id: string,
    @CurrentUser() operator: AuthUser,
    @Body() dto: AdjustBalanceDto,
  ) {
    return this.userService.adminAdjustBalance(id, operator.id, dto.amount, dto.remark)
  }
}
