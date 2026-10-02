import type { PrismaClient } from '@prisma/client'

interface SiteConfigItem {
  groupKey: string
  configKey: string
  configValue: unknown
  description: string
}

/** 网站配置默认值（平台自身品牌 / 内容，见 01-overview.md §4.2） */
const SITE_CONFIGS: SiteConfigItem[] = [
  // 基础信息
  { groupKey: 'basic', configKey: 'siteName', configValue: 'Lunar Acceleration', description: '站点名称' },
  { groupKey: 'basic', configKey: 'siteUrl', configValue: 'http://localhost:5173', description: '站点地址' },
  { groupKey: 'basic', configKey: 'logo', configValue: '', description: 'Logo 地址' },
  { groupKey: 'basic', configKey: 'favicon', configValue: '/favicon.ico', description: 'Favicon 地址' },
  { groupKey: 'basic', configKey: 'icp', configValue: '', description: 'ICP 备案号' },
  { groupKey: 'basic', configKey: 'copyright', configValue: 'Lunar Acceleration', description: '版权信息' },

  // SEO
  { groupKey: 'seo', configKey: 'title', configValue: 'Lunar Acceleration — CDN 加速控制面板', description: 'SEO 标题' },
  { groupKey: 'seo', configKey: 'keywords', configValue: 'CDN,加速,控制面板', description: 'SEO 关键词' },
  { groupKey: 'seo', configKey: 'description', configValue: '一个更简单现代的 CDN 加速控制面板', description: 'SEO 描述' },
  { groupKey: 'seo', configKey: 'robots', configValue: 'User-agent: *\nAllow: /', description: 'robots.txt' },

  // 主题外观
  { groupKey: 'theme', configKey: 'primaryColor', configValue: '#6366f1', description: '主题色' },
  { groupKey: 'theme', configKey: 'darkMode', configValue: 'auto', description: '暗黑模式：light/dark/auto' },
  { groupKey: 'theme', configKey: 'radius', configValue: 8, description: '圆角半径(px)' },

  // 注册 / 登录
  { groupKey: 'register', configKey: 'open', configValue: true, description: '是否开放注册' },
  { groupKey: 'register', configKey: 'needCaptcha', configValue: true, description: '注册是否需要验证码' },
  { groupKey: 'register', configKey: 'needEmail', configValue: false, description: '注册是否需要邮箱' },
  { groupKey: 'register', configKey: 'inviteRequired', configValue: false, description: '是否必须邀请码' },
  { groupKey: 'register', configKey: 'defaultRole', configValue: 'user', description: '默认角色标识' },

  // 多语言
  { groupKey: 'locale', configKey: 'default', configValue: 'zh-TW', description: '默认语言' },
  { groupKey: 'locale', configKey: 'enabled', configValue: ['zh-TW', 'en', 'jp', 'de'], description: '可切换语言列表' },

  // 维护模式
  { groupKey: 'maintenance', configKey: 'enabled', configValue: false, description: '维护模式开关' },
  { groupKey: 'maintenance', configKey: 'message', configValue: '系统维护中，请稍后访问。', description: '维护提示文案' },
  { groupKey: 'maintenance', configKey: 'whitelistIps', configValue: [], description: '维护白名单 IP' },

  // 公告
  { groupKey: 'notice', configKey: 'announcement', configValue: '', description: '全局公告' },
  { groupKey: 'notice', configKey: 'popup', configValue: '', description: '登录弹窗公告' },

  // 开放 API
  { groupKey: 'openapi', configKey: 'enabled', configValue: false, description: '是否开放 API' },
  { groupKey: 'openapi', configKey: 'rateLimit', configValue: 60, description: 'API 限流(次/分钟)' },
]

export async function seedSiteConfigs(prisma: PrismaClient): Promise<number> {
  for (const item of SITE_CONFIGS) {
    const configValue = item.configValue as object
    await prisma.siteConfig.upsert({
      where: {
        uk_group_key: { groupKey: item.groupKey, configKey: item.configKey },
      },
      update: { description: item.description },
      create: {
        groupKey: item.groupKey,
        configKey: item.configKey,
        configValue,
        description: item.description,
      },
    })
  }
  return SITE_CONFIGS.length
}
