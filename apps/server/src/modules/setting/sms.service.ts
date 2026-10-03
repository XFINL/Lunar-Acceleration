import { Injectable, Logger } from '@nestjs/common'
import { ErrorCode } from '@lunar/shared'
import { BusinessException } from '../../common/exceptions/business.exception'
import { SettingService } from './setting.service'

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 短信发送（站点配置 sms 分组）。
 *
 * 阿里云 / 腾讯云 短信 SDK 属于厂商接入范畴，M2 阶段仅做配置校验并返回模拟结果，
 * 返回值中的 simulated=true 表示未真实下发，待 SDK 接入后替换 sendViaProvider 实现。
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name)

  constructor(private readonly settingService: SettingService) {}

  async sendTestSms(phone: string): Promise<{
    phone: string
    provider: string
    simulated: boolean
  }> {
    const config = await this.settingService.getPublicSiteConfig('sms')
    const provider = readString(config.provider)

    if (!provider || !readString(config.signName) || !readString(config.templateCode)) {
      throw new BusinessException(
        ErrorCode.PARAM_INVALID,
        '短信配置不完整，请先在「短信配置」中填写服务商、签名与模板',
      )
    }

    this.logger.log(`[模拟短信] provider=${provider} -> ${phone}，未真实下发`)
    return { phone, provider, simulated: true }
  }
}
