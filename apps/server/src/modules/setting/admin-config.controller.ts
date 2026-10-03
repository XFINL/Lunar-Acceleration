import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { RoleType } from '@lunar/shared'
import { Type } from 'class-transformer'
import {
  Allow,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { Auditable } from '../../common/decorators/audit.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { SettingService } from './setting.service'

class ConfigItemDto {
  @ApiPropertyOptional({ description: '配置键' })
  @IsString()
  @MaxLength(128)
  configKey!: string

  @ApiPropertyOptional({ description: '配置值（任意 JSON）' })
  @Allow()
  @IsOptional()
  configValue?: unknown

  @ApiPropertyOptional({ description: '说明' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  description?: string
}

class UpdateConfigGroupDto {
  @ApiPropertyOptional({ description: '配置项列表', type: [ConfigItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfigItemDto)
  items!: ConfigItemDto[]
}

@ApiTags('管理员端 - 配置')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(RoleType.ADMIN, RoleType.SUPER_ADMIN)
export class AdminConfigController {
  constructor(private readonly settingService: SettingService) {}

  @Get('site-config')
  @RequirePermissions('site_config:read')
  @ApiOperation({ summary: '网站配置全量' })
  async getSiteConfigs() {
    return { items: await this.settingService.getSiteConfigs() }
  }

  @Get('site-config/:group')
  @RequirePermissions('site_config:read')
  @ApiOperation({ summary: '网站配置（按分组）' })
  async getSiteConfigGroup(@Param('group') group: string) {
    return { items: await this.settingService.getSiteConfigGroup(group) }
  }

  @Put('site-config/:group')
  @RequirePermissions('site_config:update')
  @Auditable({ module: 'setting', action: 'update_site_config', targetType: 'site_config' })
  @ApiOperation({ summary: '更新网站配置（按分组）' })
  async updateSiteConfigGroup(@Param('group') group: string, @Body() dto: UpdateConfigGroupDto) {
    return this.settingService.updateSiteConfigGroup(group, dto.items)
  }

  @Get('system-config')
  @RequirePermissions('system_config:read')
  @ApiOperation({ summary: '系统配置全量' })
  async getSystemConfigs() {
    return { items: await this.settingService.getSystemConfigs() }
  }

  @Get('system-config/:group')
  @RequirePermissions('system_config:read')
  @ApiOperation({ summary: '系统配置（按分组）' })
  async getSystemConfigGroup(@Param('group') group: string) {
    return { items: await this.settingService.getSystemConfigGroup(group) }
  }

  @Put('system-config/:group')
  @RequirePermissions('system_config:update')
  @Auditable({ module: 'setting', action: 'update_system_config', targetType: 'system_config' })
  @ApiOperation({ summary: '更新系统配置（按分组）' })
  async updateSystemConfigGroup(@Param('group') group: string, @Body() dto: UpdateConfigGroupDto) {
    return this.settingService.updateSystemConfigGroup(group, dto.items)
  }
}
