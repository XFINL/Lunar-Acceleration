import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { IsOptional, IsString, Length } from 'class-validator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { paginate } from '../../common/dto/response.dto'
import type { AuthUser } from '../../common/interfaces/auth-user.interface'
import { UserService } from './user.service'

class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsString()
  @Length(1, 64)
  @IsOptional()
  nickname?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  avatar?: string

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  email?: string
}

class ChangePasswordDto {
  @ApiPropertyOptional({ description: '原密码' })
  @IsString()
  oldPassword!: string

  @ApiPropertyOptional({ description: '新密码' })
  @IsString()
  @Length(8, 32)
  newPassword!: string
}

class CreateApiKeyDto {
  @ApiPropertyOptional({ description: '密钥名称' })
  @IsString()
  @Length(1, 64)
  name!: string
}

class UpdateApiKeyDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string

  @ApiPropertyOptional({ description: '0禁用 1启用' })
  @IsOptional()
  status?: number
}

@ApiTags('用户端 - 账户中心')
@ApiBearerAuth()
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('profile')
  @ApiOperation({ summary: '获取个人资料' })
  async getProfile(@CurrentUser() user: AuthUser) {
    return this.userService.getProfile(user.id)
  }

  @Put('profile')
  @ApiOperation({ summary: '更新个人资料' })
  async updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.userService.updateProfile(user.id, dto)
  }

  @Put('password')
  @ApiOperation({ summary: '修改密码' })
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.userService.changePassword(user.id, dto.oldPassword, dto.newPassword)
  }

  @Get('login-logs')
  @ApiOperation({ summary: '登录记录' })
  async loginLogs(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    const { total, list } = await this.userService.listLoginLogs(
      user.id,
      query.page,
      query.pageSize,
    )
    return paginate(list, query.page, query.pageSize, total)
  }

  @Get('api-keys')
  @ApiOperation({ summary: 'API 密钥列表' })
  async listApiKeys(@CurrentUser() user: AuthUser) {
    return this.userService.listApiKeys(user.id)
  }

  @Post('api-keys')
  @ApiOperation({ summary: '创建 API 密钥（SecretKey 仅返回一次）' })
  async createApiKey(@CurrentUser() user: AuthUser, @Body() dto: CreateApiKeyDto) {
    return this.userService.createApiKey(user.id, dto.name)
  }

  @Put('api-keys/:id')
  @ApiOperation({ summary: '更新 API 密钥' })
  async updateApiKey(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateApiKeyDto,
  ) {
    return this.userService.updateApiKey(user.id, id, dto)
  }

  @Delete('api-keys/:id')
  @ApiOperation({ summary: '删除 API 密钥' })
  async removeApiKey(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.userService.removeApiKey(user.id, id)
  }
}
