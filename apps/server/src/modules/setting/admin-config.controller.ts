import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger'
import { ErrorCode, RoleType } from '@lunar/shared'
import { Type } from 'class-transformer'
import {
  Allow,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { Auditable } from '../../common/decorators/audit.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { BusinessException } from '../../common/exceptions/business.exception'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { MailService } from './mail.service'
import { SettingService } from './setting.service'
import { SmsService } from './sms.service'
import { LocalStorageService } from './storage/local.storage'

/** 允许上传的类型（见 05-backend.md §14.2） */
const ALLOWED_UPLOAD_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
])
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024

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

class TestEmailDto {
  @ApiPropertyOptional({ description: '接收测试邮件的邮箱' })
  @IsEmail()
  to!: string
}

class TestSmsDto {
  @ApiPropertyOptional({ description: '接收测试短信的手机号' })
  @IsString()
  @Matches(/^\+?\d{6,20}$/, { message: '手机号格式不正确' })
  to!: string
}

@ApiTags('管理员端 - 配置')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(RoleType.ADMIN, RoleType.SUPER_ADMIN)
export class AdminConfigController {
  constructor(
    private readonly settingService: SettingService,
    private readonly localStorage: LocalStorageService,
    private readonly mailService: MailService,
    private readonly smsService: SmsService,
  ) {}

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

  @Post('site-config/upload')
  @RequirePermissions('site_config:update')
  @Auditable({ module: 'setting', action: 'upload_site_config_file', targetType: 'site_config' })
  @ApiOperation({ summary: '上传文件（Logo / Favicon 等）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', description: '用途分类，默认 site' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_SIZE } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Body('type') type?: string) {
    if (!file) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '请选择要上传的文件')
    }
    if (!ALLOWED_UPLOAD_MIME.has(file.mimetype)) {
      throw new BusinessException(
        ErrorCode.PARAM_INVALID,
        `不支持的文件类型：${file.mimetype}（仅支持图片 / PDF / ZIP）`,
      )
    }
    return this.localStorage.save(file, type || 'site')
  }

  @Post('site-config/test-email')
  @RequirePermissions('site_config:update')
  @Auditable({ module: 'setting', action: 'test_email', targetType: 'site_config' })
  @ApiOperation({ summary: '发送测试邮件' })
  async testEmail(@Body() dto: TestEmailDto) {
    return this.mailService.sendTestMail(dto.to)
  }

  @Post('site-config/test-sms')
  @RequirePermissions('site_config:update')
  @Auditable({ module: 'setting', action: 'test_sms', targetType: 'site_config' })
  @ApiOperation({ summary: '发送测试短信' })
  async testSms(@Body() dto: TestSmsDto) {
    return this.smsService.sendTestSms(dto.to)
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
