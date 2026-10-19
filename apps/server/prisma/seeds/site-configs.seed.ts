import type { PrismaClient } from '@prisma/client'

interface SiteConfigItem {
  groupKey: string
  configKey: string
  configValue: unknown
  description: string
}

/** Website-facing settings; defaults are insert-only so seed reruns never overwrite operator values. */
const SITE_CONFIGS: SiteConfigItem[] = [
  { groupKey: 'basic', configKey: 'siteName', configValue: 'Lunar Acceleration', description: '站点名称' },
  { groupKey: 'basic', configKey: 'siteUrl', configValue: 'http://localhost:5173', description: '站点地址' },
  { groupKey: 'basic', configKey: 'logo', configValue: '', description: 'Logo 地址' },
  { groupKey: 'basic', configKey: 'favicon', configValue: '/favicon.ico', description: 'Favicon 地址' },
  { groupKey: 'basic', configKey: 'icp', configValue: '', description: 'ICP 备案号' },
  { groupKey: 'basic', configKey: 'copyright', configValue: 'Lunar Acceleration', description: '版权信息' },
  { groupKey: 'seo', configKey: 'title', configValue: 'Lunar Acceleration — CDN 加速控制面板', description: 'SEO 标题' },
  { groupKey: 'seo', configKey: 'keywords', configValue: 'CDN,加速,控制面板', description: 'SEO 关键词' },
  { groupKey: 'seo', configKey: 'description', configValue: '一个更简单现代的 CDN 加速控制面板', description: 'SEO 描述' },
  { groupKey: 'seo', configKey: 'robots', configValue: 'User-agent: *\nAllow: /', description: 'robots.txt' },
  { groupKey: 'theme', configKey: 'primaryColor', configValue: '#6366f1', description: '主题色' },
  { groupKey: 'nav', configKey: 'showDocs', configValue: true, description: '导航显示文档入口' },
  { groupKey: 'nav', configKey: 'docsUrl', configValue: '', description: '文档地址' },
  { groupKey: 'nav', configKey: 'supportUrl', configValue: '', description: '支持链接' },
  { groupKey: 'home', configKey: 'headline', configValue: '', description: '首页标题' },
  { groupKey: 'home', configKey: 'subheadline', configValue: '', description: '首页副标题' },
  { groupKey: 'theme', configKey: 'darkMode', configValue: 'auto', description: '暗黑模式：light/dark/auto' },
  { groupKey: 'theme', configKey: 'radius', configValue: 8, description: '圆角半径(px)' },
  { groupKey: 'register', configKey: 'open', configValue: true, description: '是否开放注册' },
  { groupKey: 'register', configKey: 'needCaptcha', configValue: true, description: '注册是否需要验证码（登录验证码始终启用）' },
  { groupKey: 'register', configKey: 'needEmail', configValue: false, description: '注册是否需要邮箱' },
  { groupKey: 'register', configKey: 'inviteRequired', configValue: false, description: '是否必须邀请码' },
  { groupKey: 'register', configKey: 'defaultRole', configValue: 'user', description: '默认角色标识' },
  { groupKey: 'auth', configKey: 'registerOpen', configValue: true, description: '注册开关（兼容 register.open）' },
  { groupKey: 'auth', configKey: 'registerNeedCaptcha', configValue: true, description: '注册验证码开关（登录验证码始终强制）' },
  { groupKey: 'auth', configKey: 'registerNeedEmail', configValue: false, description: '注册邮箱要求' },
  { groupKey: 'auth', configKey: 'inviteRequired', configValue: false, description: '注册邀请码要求' },
  { groupKey: 'locale', configKey: 'default', configValue: 'zh-TW', description: '默认语言' },
  { groupKey: 'locale', configKey: 'enabled', configValue: ['zh-TW', 'en', 'jp', 'de'], description: '可切换语言列表' },
  { groupKey: 'i18n', configKey: 'default', configValue: 'zh-TW', description: '默认语言（兼容 locale.default）' },
  { groupKey: 'i18n', configKey: 'enabled', configValue: ['zh-TW', 'en', 'jp', 'de'], description: '可切换语言列表（兼容 locale.enabled）' },
  { groupKey: 'maintenance', configKey: 'enabled', configValue: false, description: '维护模式开关（全局拦截，管理员及 IP 白名单可访问）' },
  { groupKey: 'maintenance', configKey: 'message', configValue: '系统维护中，请稍后访问。', description: '维护提示文案' },
  { groupKey: 'maintenance', configKey: 'whitelistIps', configValue: [], description: '维护白名单 IP' },
  { groupKey: 'service', configKey: 'statusUrl', configValue: '', description: '服务状态页面（当前仅保存）' },
  { groupKey: 'service', configKey: 'supportUrl', configValue: '', description: '服务支持链接' },
  { groupKey: 'agreement', configKey: 'termsUrl', configValue: '', description: '服务条款地址' },
  { groupKey: 'agreement', configKey: 'privacyUrl', configValue: '', description: '隐私政策地址' },
  { groupKey: 'notice', configKey: 'announcement', configValue: '', description: '全局公告' },
  { groupKey: 'notice', configKey: 'popup', configValue: '', description: '登录弹窗公告' },
  { groupKey: 'openapi', configKey: 'enabled', configValue: false, description: '是否开放 API' },
  { groupKey: 'openapi', configKey: 'rateLimit', configValue: 60, description: 'API 限流(次/分钟)' },
  { groupKey: 'email', configKey: 'host', configValue: '', description: 'SMTP 服务器地址' },
  { groupKey: 'email', configKey: 'port', configValue: 465, description: 'SMTP 端口' },
  { groupKey: 'email', configKey: 'secure', configValue: true, description: '是否使用 SSL/TLS' },
  { groupKey: 'email', configKey: 'user', configValue: '', description: 'SMTP 账号' },
  { groupKey: 'email', configKey: 'pass', configValue: '', description: 'SMTP 密码 / 授权码' },
  { groupKey: 'email', configKey: 'from', configValue: '', description: '发件人，留空取账号' },
  { groupKey: 'sms', configKey: 'provider', configValue: '', description: '服务商：aliyun / tencent' },
  { groupKey: 'sms', configKey: 'signName', configValue: '', description: '短信签名' },
  { groupKey: 'sms', configKey: 'templateCode', configValue: '', description: '模板编码' },
  { groupKey: 'sms', configKey: 'accessKeyId', configValue: '', description: 'AccessKey ID' },
  { groupKey: 'sms', configKey: 'accessKeySecret', configValue: '', description: 'AccessKey Secret' },
  { groupKey: 'oauth', configKey: 'enabled', configValue: false, description: 'OAuth 登录开关（OAuth 模块消费）' },
  { groupKey: 'oauth', configKey: 'clientId', configValue: '', description: 'OAuth 客户端 ID' },
  { groupKey: 'oauth', configKey: 'clientSecret', configValue: '', description: 'OAuth 客户端密钥' },
  { groupKey: 'oauth', configKey: 'callbackUrl', configValue: '', description: 'OAuth 回调 URL' },
  { groupKey: 'api', configKey: 'enabled', configValue: false, description: 'API 访问开关（OpenAPI 模块消费）' },
  { groupKey: 'api', configKey: 'rateLimit', configValue: 60, description: 'API 限流上限（OpenAPI 模块消费）' },
  { groupKey: 'api', configKey: 'allowOrigins', configValue: [], description: 'API CORS 来源（OpenAPI 模块消费）' },
  { groupKey: 'storage', configKey: 'provider', configValue: '', description: '对象存储服务商（当前仅保存）' },
  { groupKey: 'storage', configKey: 'bucket', configValue: '', description: '对象存储 Bucket（当前仅保存）' },
  { groupKey: 'storage', configKey: 'region', configValue: '', description: '对象存储 Region（当前仅保存）' },
  { groupKey: 'storage', configKey: 'accessKeyId', configValue: '', description: '对象存储 AccessKey ID' },
  { groupKey: 'storage', configKey: 'accessKeySecret', configValue: '', description: '对象存储 AccessKey Secret' },
  { groupKey: 'payment', configKey: 'enabled', configValue: false, description: '支付开关（支付集成模块消费）' },
  { groupKey: 'payment', configKey: 'currency', configValue: 'USD', description: '结算币种（支付集成模块消费）' },
  { groupKey: 'security', configKey: 'allowUserApiKeys', configValue: true, description: '用户 API Key 开关（当前仅保存）' },
  { groupKey: 'security', configKey: 'sessionNotice', configValue: '', description: '安全提示（当前仅保存）' },
  { groupKey: 'upload', configKey: 'maxSizeMb', configValue: 10, description: '上传大小上限（当前上传模块单独限制）' },
  { groupKey: 'upload', configKey: 'allowedExtensions', configValue: ['jpg', 'png', 'gif', 'webp', 'ico'], description: '允许扩展名（当前上传模块单独限制）' },
  { groupKey: 'analytics', configKey: 'provider', configValue: '', description: '分析服务商（仅保存，禁止注入第三方脚本）' },
  { groupKey: 'analytics', configKey: 'measurementId', configValue: '', description: '分析 ID（仅保存，禁止注入第三方脚本）' },
  { groupKey: 'custom', configKey: 'css', configValue: '', description: '自定义 CSS（仅保存，不执行）' },
  { groupKey: 'custom', configKey: 'headHtml', configValue: '', description: '自定义 HTML/脚本（仅保存，不执行）' },
]

export async function seedSiteConfigs(prisma: PrismaClient): Promise<number> {
  for (const item of SITE_CONFIGS) {
    const aliases: Record<string, string> = { registerOpen: 'open', registerNeedCaptcha: 'needCaptcha', registerNeedEmail: 'needEmail', inviteRequired: 'inviteRequired' }
    const legacyKey = item.groupKey === 'auth' ? aliases[item.configKey] : undefined
    const legacyValue = legacyKey ? await prisma.siteConfig.findUnique({ where: { uk_group_key: { groupKey: 'register', configKey: legacyKey } } }) : null
    await prisma.siteConfig.upsert({
      where: { uk_group_key: { groupKey: item.groupKey, configKey: item.configKey } },
      update: {},
      create: { groupKey: item.groupKey, configKey: item.configKey, configValue: (legacyValue?.configValue ?? item.configValue) as object, description: item.description },
    })
  }
  return SITE_CONFIGS.length
}
