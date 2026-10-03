import { Module } from '@nestjs/common'
import { AdminConfigController } from './admin-config.controller'
import { MailService } from './mail.service'
import { SettingService } from './setting.service'
import { SiteConfigController } from './site-config.controller'
import { SmsService } from './sms.service'
import { LocalStorageService } from './storage/local.storage'

@Module({
  controllers: [SiteConfigController, AdminConfigController],
  providers: [SettingService, LocalStorageService, MailService, SmsService],
  exports: [SettingService],
})
export class SettingModule {}
