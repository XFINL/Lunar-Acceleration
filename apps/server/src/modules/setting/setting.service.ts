import { Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { SecurityConfig } from '../../config/configuration'
import { decrypt, encrypt } from '../../common/utils/crypto.util'
import { Prisma } from '@prisma/client'
import { ErrorCode } from '@lunar/shared'
import { BusinessException } from '../../common/exceptions/business.exception'
import { PrismaService } from '../../database/prisma.service'

export interface ConfigItemInput {
  configKey: string
  configValue?: unknown
  description?: string
}

export interface SiteConfigVo {
  groupKey: string
  configKey: string
  configValue: Prisma.JsonValue
  description: string | null
  updatedAt: Date
}

const MASKED_SECRET = '********'
const SITE_KEYS: Record<string, Record<string, 'string' | 'boolean' | 'number' | 'array' | 'object'>> = {
  basic: { siteName: 'string', siteUrl: 'string', logo: 'string', favicon: 'string', icp: 'string', copyright: 'string' },
  seo: { title: 'string', keywords: 'string', description: 'string', robots: 'string' },
  theme: { primaryColor: 'string', darkMode: 'string', radius: 'number' },
  nav: { showDocs: 'boolean', docsUrl: 'string', supportUrl: 'string' },
  home: { headline: 'string', subheadline: 'string' },
  auth: { registerOpen: 'boolean', registerNeedCaptcha: 'boolean', registerNeedEmail: 'boolean', inviteRequired: 'boolean' },
  register: { open: 'boolean', needCaptcha: 'boolean', needEmail: 'boolean', inviteRequired: 'boolean', defaultRole: 'string' },
  locale: { default: 'string', enabled: 'array' },
  i18n: { default: 'string', enabled: 'array' },
  maintenance: { enabled: 'boolean', message: 'string', whitelistIps: 'array' },
  service: { statusUrl: 'string', supportUrl: 'string' },
  agreement: { termsUrl: 'string', privacyUrl: 'string' },
  notice: { announcement: 'string', popup: 'string' },
  openapi: { enabled: 'boolean', rateLimit: 'number' },
  email: { host: 'string', port: 'number', secure: 'boolean', user: 'string', pass: 'string', from: 'string' },
  sms: { provider: 'string', signName: 'string', templateCode: 'string', accessKeyId: 'string', accessKeySecret: 'string' },
  oauth: { enabled: 'boolean', clientId: 'string', clientSecret: 'string', callbackUrl: 'string' },
  api: { enabled: 'boolean', rateLimit: 'number', allowOrigins: 'array' },
  storage: { provider: 'string', bucket: 'string', region: 'string', accessKeyId: 'string', accessKeySecret: 'string' },
  payment: { enabled: 'boolean', currency: 'string' },
  security: { allowUserApiKeys: 'boolean', sessionNotice: 'string' },
  upload: { maxSizeMb: 'number', allowedExtensions: 'array' },
  analytics: { provider: 'string', measurementId: 'string' },
  custom: { css: 'string', headHtml: 'string' },
}
const SYSTEM_KEYS: Record<string, Record<string, 'string' | 'boolean' | 'number'>> = {
  cache: { defaultTtl: 'number', ignoreQuery: 'boolean' },
  security: { captchaEnabled: 'boolean', loginFailLimit: 'number', loginLockSeconds: 'number' },
  throttle: { globalTtl: 'number', globalLimit: 'number' },
  log: { level: 'string', accessRetentionDays: 'number' },
  queue: { concurrency: 'number' },
  feature: { selfNodeEnabled: 'boolean', vendorEnabled: 'boolean', realtimeLogEnabled: 'boolean' },
}
const PUBLIC_KEYS: Record<string, string[]> = {
  basic: ['siteName', 'siteUrl', 'logo', 'favicon', 'icp', 'copyright'],
  seo: ['title', 'keywords', 'description', 'robots'],
  theme: ['primaryColor', 'darkMode', 'radius'],
  nav: ['showDocs', 'docsUrl', 'supportUrl'],
  home: ['headline', 'subheadline'],
  auth: ['registerOpen', 'registerNeedCaptcha', 'registerNeedEmail', 'inviteRequired'],
  register: ['open', 'needCaptcha', 'needEmail', 'inviteRequired', 'defaultRole'],
  locale: ['default', 'enabled'],
  i18n: ['default', 'enabled'],
  maintenance: ['enabled', 'message'],
  service: ['statusUrl', 'supportUrl'],
  agreement: ['termsUrl', 'privacyUrl'],
  notice: ['announcement', 'popup'],
  openapi: ['enabled', 'rateLimit'],
}
const SECRET_KEYS = new Set(['email.pass', 'sms.accessKeyId', 'sms.accessKeySecret', 'oauth.clientSecret', 'storage.accessKeyId', 'storage.accessKeySecret'])
const SECRET_PATTERN = /^(?:\*{4,}|•{4,}|<redacted>)$/i
const KNOWN_MASKS = new Set(['••••••••', '[redacted]', '********'])

@Injectable()
export class SettingService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly configService?: ConfigService) {}

  async getSiteConfigs(): Promise<SiteConfigVo[]> {
    const rows = await this.prisma.siteConfig.findMany({ orderBy: [{ groupKey: 'asc' }, { configKey: 'asc' }] })
    return rows.filter((row) => SITE_KEYS[row.groupKey]?.[row.configKey]).map((row) => this.toSiteConfigVo(row, true))
  }

  async getSiteConfigGroup(group: string): Promise<SiteConfigVo[]> {
    this.assertGroup(SITE_KEYS, group)
    const rows = await this.prisma.siteConfig.findMany({ where: { groupKey: group }, orderBy: { configKey: 'asc' } })
    return rows.filter((row) => SITE_KEYS[group][row.configKey]).map((row) => this.toSiteConfigVo(row, true))
  }

  async updateSiteConfigGroup(group: string, items: ConfigItemInput[]) {
    return this.updateGroup('siteConfig', SITE_KEYS, group, items)
  }

  async getPublicSiteConfig(group: string): Promise<Record<string, Prisma.JsonValue>> {
    const allowedKeys = PUBLIC_KEYS[group]
    if (!allowedKeys) throw this.invalid(`网站配置分组 ${group} 不公开或不存在`)
    const rows = await this.prisma.siteConfig.findMany({ where: { groupKey: group } })
    const result: Record<string, Prisma.JsonValue> = {}
    for (const row of rows) if (allowedKeys.includes(row.configKey)) result[row.configKey] = row.configValue
    if (group === 'register') {
      const aliases: Array<[string, string]> = [['open', 'registerOpen'], ['needCaptcha', 'registerNeedCaptcha'], ['needEmail', 'registerNeedEmail'], ['inviteRequired', 'inviteRequired']]
      for (const [legacyKey, canonicalKey] of aliases) {
        const canonical = await this.prisma.siteConfig.findUnique({ where: { uk_group_key: { groupKey: 'auth', configKey: canonicalKey } } })
        const legacy = rows.find((row) => row.configKey === legacyKey)
        if (canonical && (!legacy || canonical.updatedAt.getTime() >= legacy.updatedAt.getTime())) result[legacyKey] = canonical.configValue
      }
    }
    return result
  }

  async getSiteConfigValue(group: string, key: string): Promise<unknown> {
    const row = await this.prisma.siteConfig.findUnique({ where: { uk_group_key: { groupKey: group, configKey: key } } })
    return row?.configValue ?? undefined
  }

  async getRegistrationConfig(canonicalKey: string, legacyKey: string): Promise<unknown> {
    const [canonical, legacy] = await Promise.all([
      this.prisma.siteConfig.findUnique({ where: { uk_group_key: { groupKey: 'auth', configKey: canonicalKey } } }),
      this.prisma.siteConfig.findUnique({ where: { uk_group_key: { groupKey: 'register', configKey: legacyKey } } }),
    ])
    if (!canonical) return legacy?.configValue ?? undefined
    if (!legacy) return canonical.configValue
    return canonical.updatedAt.getTime() >= legacy.updatedAt.getTime() ? canonical.configValue : legacy.configValue
  }


  async getInternalSiteConfigGroup(group: string): Promise<Record<string, unknown>> {
    const rows = await this.prisma.siteConfig.findMany({ where: { groupKey: group } })
    return Object.fromEntries(rows.map((row) => [row.configKey, this.decryptSecret(group, row.configKey, row.configValue)]))
  }

  async getSystemConfigs(): Promise<SiteConfigVo[]> {
    const rows = await this.prisma.systemConfig.findMany({ orderBy: [{ groupKey: 'asc' }, { configKey: 'asc' }] })
    return rows.filter((row) => SYSTEM_KEYS[row.groupKey]?.[row.configKey]).map((row) => this.toSiteConfigVo(row, false))
  }

  async getSystemConfigGroup(group: string): Promise<SiteConfigVo[]> {
    this.assertGroup(SYSTEM_KEYS, group)
    const rows = await this.prisma.systemConfig.findMany({ where: { groupKey: group }, orderBy: { configKey: 'asc' } })
    return rows.filter((row) => SYSTEM_KEYS[group][row.configKey]).map((row) => this.toSiteConfigVo(row, false))
  }

  async updateSystemConfigGroup(group: string, items: ConfigItemInput[]) {
    return this.updateGroup('systemConfig', SYSTEM_KEYS, group, items)
  }

  private async updateGroup(modelName: 'siteConfig' | 'systemConfig', groups: Record<string, Record<string, string>>, group: string, items: ConfigItemInput[]) {
    this.assertGroup(groups, group)
    if (!Array.isArray(items) || items.length > 256) throw this.invalid('配置项列表无效')
    const seen = new Set<string>()
    for (const item of items) {
      if (!item || typeof item.configKey !== 'string' || !groups[group][item.configKey]) throw this.invalid(`未知配置键：${item?.configKey ?? ''}`)
      if (seen.has(item.configKey)) throw this.invalid(`配置键重复：${item.configKey}`)
      seen.add(item.configKey)
      const secret = modelName === 'siteConfig' && SECRET_KEYS.has(`${group}.${item.configKey}`)
      if (secret && (item.configValue === undefined || typeof item.configValue === 'string' && (!item.configValue.trim() || SECRET_PATTERN.test(item.configValue.trim()) || KNOWN_MASKS.has(item.configValue.trim())))) continue
      this.validateValue(group, item.configKey, groups[group][item.configKey], item.configValue)
    }
    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const secret = modelName === 'siteConfig' && SECRET_KEYS.has(`${group}.${item.configKey}`)
        if (secret && (item.configValue === undefined || typeof item.configValue === 'string' && (!item.configValue.trim() || SECRET_PATTERN.test(item.configValue.trim()) || KNOWN_MASKS.has(item.configValue.trim())))) continue
        const model = tx[modelName] as typeof tx.siteConfig
        await model.upsert({
          where: { uk_group_key: { groupKey: group, configKey: item.configKey } },
          create: { groupKey: group, configKey: item.configKey, configValue: this.toJsonInput(this.encodeSecret(modelName, group, item.configKey, item.configValue)), description: item.description ?? null },
          update: { configValue: this.toJsonInput(this.encodeSecret(modelName, group, item.configKey, item.configValue)), ...(item.description === undefined ? {} : { description: item.description }) },
        })
      }
    })
    return { count: items.length }
  }

  private validateValue(group: string, key: string, type: string, value: unknown): void {
    if (type === 'array' ? !Array.isArray(value) : type === 'object' ? value === null || typeof value !== 'object' || Array.isArray(value) : typeof value !== type) {
      throw this.invalid(`配置 ${group}.${key} 类型必须为 ${type}`)
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw this.invalid(`配置 ${group}.${key} 必须为有限数值`)
      const bounds: Record<string, [number, number]> = {
        'theme.radius': [0, 64], 'openapi.rateLimit': [1, 100000], 'api.rateLimit': [1, 100000], 'email.port': [1, 65535], 'upload.maxSizeMb': [1, 100],
        'cache.defaultTtl': [0, 31536000], 'security.loginFailLimit': [1, 100], 'security.loginLockSeconds': [1, 604800],
        'throttle.globalTtl': [1, 86400], 'throttle.globalLimit': [1, 1000000], 'log.accessRetentionDays': [1, 3650], 'queue.concurrency': [1, 1000],
      }
      const [min, max] = bounds[`${group}.${key}`] ?? [0, 1000000000]
      if (value < min || value > max) throw this.invalid(`配置 ${group}.${key} 范围必须为 ${min} 至 ${max}`)
    }
    if (typeof value === 'string') {
      if (value.length > 10000) throw this.invalid(`配置 ${group}.${key} 长度过长`)
      if (group === 'theme' && key === 'primaryColor' && !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) throw this.invalid('主题色必须为十六进制颜色')
      if (group === 'theme' && key === 'darkMode' && !['light', 'dark', 'auto'].includes(value)) throw this.invalid('darkMode 仅支持 light/dark/auto')
      if (group === 'log' && key === 'level' && !['error', 'warn', 'info', 'debug', 'verbose'].includes(value)) throw this.invalid('日志级别无效')
      if (group === 'sms' && key === 'provider' && value && !['aliyun', 'tencent'].includes(value)) throw this.invalid('短信服务商仅支持 aliyun/tencent')
      if ((group === 'storage' || group === 'oauth') && key === 'enabled' && typeof value !== 'boolean') throw this.invalid(`配置 ${group}.${key} 类型无效`)
      if (group === 'locale' && key === 'default' && !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)?$/.test(value)) throw this.invalid('默认语言格式无效')
    }
    if (Array.isArray(value) && (value.length > 100 || value.some((entry) => typeof entry !== 'string' || entry.length > 500))) throw this.invalid(`配置 ${group}.${key} 数组内容无效`)
  }

  private encodeSecret(modelName: 'siteConfig' | 'systemConfig', group: string, key: string, value: unknown): unknown {
    if (modelName !== 'siteConfig' || !SECRET_KEYS.has(`${group}.${key}`) || typeof value !== 'string') return value
    const encryptionKey = this.configService?.get<SecurityConfig>('security')?.encryptionKey
    if (!encryptionKey) throw this.invalid('缺少安全加密密钥，无法保存敏感配置')
    return `enc:v1:${encrypt(value, encryptionKey)}`
  }

  private decryptSecret(group: string, key: string, value: unknown): unknown {
    if (typeof value !== 'string' || !SECRET_KEYS.has(`${group}.${key}`) || !value.startsWith('enc:v1:')) return value
    const encryptionKey = this.configService?.get<SecurityConfig>('security')?.encryptionKey
    if (!encryptionKey) throw this.invalid('缺少安全加密密钥，无法读取敏感配置')
    try { return decrypt(value.slice('enc:v1:'.length), encryptionKey) } catch { throw this.invalid(`无法解密配置 ${group}.${key}`) }
  }

  private assertGroup(groups: Record<string, unknown>, group: string): void {
    if (!Object.prototype.hasOwnProperty.call(groups, group)) throw this.invalid(`未知配置分组：${group}`)
  }

  private invalid(message: string): BusinessException { return new BusinessException(ErrorCode.PARAM_INVALID, message) }
  private toJsonInput(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    if (value === null || value === undefined) return Prisma.JsonNull
    return value as Prisma.InputJsonValue
  }

  private toSiteConfigVo(row: { groupKey: string; configKey: string; configValue: Prisma.JsonValue; description: string | null; updatedAt: Date }, redactSecrets: boolean): SiteConfigVo {
    const secret = redactSecrets && SECRET_KEYS.has(`${row.groupKey}.${row.configKey}`)
    return { groupKey: row.groupKey, configKey: row.configKey, configValue: secret ? (row.configValue ? MASKED_SECRET : '') : row.configValue, description: row.description, updatedAt: row.updatedAt }
  }
}
