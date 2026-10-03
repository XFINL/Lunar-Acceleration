import { Controller, Get, Param } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Public } from '../../common/decorators/public.decorator'
import { SettingService } from './setting.service'

@ApiTags('用户端 - 网站配置')
@Public()
@Controller('user/site-config')
export class SiteConfigController {
  constructor(private readonly settingService: SettingService) {}

  @Get(':group')
  @ApiOperation({ summary: '按分组获取网站配置（公开）' })
  async getGroup(@Param('group') group: string) {
    return this.settingService.getPublicSiteConfig(group)
  }
}
