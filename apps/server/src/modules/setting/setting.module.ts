import { Module } from '@nestjs/common'
import { AdminConfigController } from './admin-config.controller'
import { SettingService } from './setting.service'
import { SiteConfigController } from './site-config.controller'

@Module({
  controllers: [SiteConfigController, AdminConfigController],
  providers: [SettingService],
  exports: [SettingService],
})
export class SettingModule {}
