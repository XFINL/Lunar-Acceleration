import type { PrismaClient } from '@prisma/client'

interface SystemConfigItem {
  groupKey: string
  configKey: string
  configValue: unknown
  description: string
}

/** Technical configuration; upserts only create missing values and preserve operator changes. */
const SYSTEM_CONFIGS: SystemConfigItem[] = [
  { groupKey: 'cache', configKey: 'defaultTtl', configValue: 3600, description: '默认缓存 TTL(秒)' },
  { groupKey: 'cache', configKey: 'ignoreQuery', configValue: true, description: '默认忽略 URL 参数' },
  { groupKey: 'security', configKey: 'captchaEnabled', configValue: true, description: '验证码配置（登录验证码仍始终强制）' },
  { groupKey: 'security', configKey: 'loginFailLimit', configValue: 5, description: '登录失败锁定次数（当前使用环境配置）' },
  { groupKey: 'security', configKey: 'loginLockSeconds', configValue: 1800, description: '登录锁定时长(秒)（当前使用环境配置）' },
  { groupKey: 'throttle', configKey: 'globalTtl', configValue: 60, description: '全局限流窗口(秒)' },
  { groupKey: 'throttle', configKey: 'globalLimit', configValue: 100, description: '全局限流次数' },
  { groupKey: 'log', configKey: 'level', configValue: 'info', description: '日志级别（当前仅保存）' },
  { groupKey: 'log', configKey: 'accessRetentionDays', configValue: 30, description: '访问日志保留天数（当前仅保存）' },
  { groupKey: 'queue', configKey: 'concurrency', configValue: 10, description: '队列并发数（当前仅保存）' },
  { groupKey: 'feature', configKey: 'selfNodeEnabled', configValue: true, description: '自建节点模式开关（当前仅保存）' },
  { groupKey: 'feature', configKey: 'vendorEnabled', configValue: true, description: '第三方厂商模式开关（当前仅保存）' },
  { groupKey: 'feature', configKey: 'realtimeLogEnabled', configValue: false, description: '实时日志开关（当前仅保存）' },
]

export async function seedSystemConfigs(prisma: PrismaClient): Promise<number> {
  for (const item of SYSTEM_CONFIGS) {
    await prisma.systemConfig.upsert({
      where: { uk_group_key: { groupKey: item.groupKey, configKey: item.configKey } },
      update: {},
      create: { groupKey: item.groupKey, configKey: item.configKey, configValue: item.configValue as object, description: item.description },
    })
  }
  return SYSTEM_CONFIGS.length
}
