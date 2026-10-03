import { Injectable, Logger } from '@nestjs/common'
import nodemailer from 'nodemailer'
import { ErrorCode } from '@lunar/shared'
import { BusinessException } from '../../common/exceptions/business.exception'
import { SettingService } from './setting.service'

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  const parsed = Number.parseInt(readString(value), 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

/** 邮件发送（见 05-backend.md §13.4，基于站点配置 email 分组） */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)

  constructor(private readonly settingService: SettingService) {}

  async sendTestMail(to: string): Promise<{ to: string; messageId: string }> {
    const config = await this.settingService.getPublicSiteConfig('email')
    const host = readString(config.host)
    const user = readString(config.user)
    const pass = readString(config.pass)

    if (!host || !user || !pass) {
      throw new BusinessException(
        ErrorCode.PARAM_INVALID,
        '邮箱 SMTP 配置不完整，请先在「邮件配置」中填写服务器、账号与密码',
      )
    }

    const transporter = nodemailer.createTransport({
      host,
      port: readNumber(config.port) ?? 465,
      secure: config.secure !== false,
      auth: { user, pass },
    })

    try {
      await transporter.verify()
      const info = await transporter.sendMail({
        from: readString(config.from) || user,
        to,
        subject: '测试邮件 - Lunar Acceleration',
        text: '这是一封来自 Lunar Acceleration 控制面板的测试邮件，收到即表示邮件配置正常。',
      })
      return { to, messageId: info.messageId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`测试邮件发送失败: ${message}`)
      throw new BusinessException(ErrorCode.VENDOR_API_ERROR, `邮件发送失败：${message}`)
    } finally {
      transporter.close()
    }
  }
}
