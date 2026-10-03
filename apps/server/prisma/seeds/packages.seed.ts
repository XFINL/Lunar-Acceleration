import type { Prisma, PrismaClient } from '@prisma/client'
import { OverQuotaPolicy, PackageAccessType, PackagePeriod } from '@lunar/shared'

interface PackageItem {
  name: string
  code: string
  description: string
  accessType: PackageAccessType
  trafficQuota: bigint
  bandwidthLimit: number
  domainLimit: number
  requestQuota: bigint
  featureFlags: Record<string, unknown>
  overQuotaPolicy: OverQuotaPolicy
  price: string
  period: PackagePeriod
  sort: number
}

const GB = 1024n ** 3n
const TB = 1024n * GB

/** 默认套餐（示例数据，价格与额度可在管理端调整） */
const PACKAGES: PackageItem[] = [
  {
    name: '体验版',
    code: 'starter',
    description: '适合个人站点试用',
    accessType: PackageAccessType.SELF_NODE,
    trafficQuota: 10n * GB,
    bandwidthLimit: 10240,
    domainLimit: 3,
    requestQuota: 1_000_000n,
    featureFlags: {
      waf: false,
      realtime_log: false,
      log_delivery: false,
      custom_cache_key: true,
      ip_region_block: false,
      max_cache_rules: 10,
    },
    overQuotaPolicy: OverQuotaPolicy.LIMIT_SPEED,
    price: '0.00',
    period: PackagePeriod.MONTH,
    sort: 1,
  },
  {
    name: '标准版',
    code: 'standard',
    description: '中小型业务常用',
    accessType: PackageAccessType.HYBRID,
    trafficQuota: 500n * GB,
    bandwidthLimit: 102400,
    domainLimit: 20,
    requestQuota: 100_000_000n,
    featureFlags: {
      waf: true,
      realtime_log: true,
      log_delivery: false,
      custom_cache_key: true,
      ip_region_block: true,
      max_cache_rules: 50,
    },
    overQuotaPolicy: OverQuotaPolicy.PAY_AS_YOU_GO,
    price: '99.00',
    period: PackagePeriod.MONTH,
    sort: 2,
  },
  {
    name: '企业版',
    code: 'enterprise',
    description: '高流量企业级方案',
    accessType: PackageAccessType.HYBRID,
    trafficQuota: 5n * TB,
    bandwidthLimit: 1048576,
    domainLimit: 200,
    requestQuota: 5_000_000_000n,
    featureFlags: {
      waf: true,
      realtime_log: true,
      log_delivery: true,
      custom_cache_key: true,
      ip_region_block: true,
      max_cache_rules: 500,
    },
    overQuotaPolicy: OverQuotaPolicy.SUSPEND,
    price: '899.00',
    period: PackagePeriod.YEAR,
    sort: 3,
  },
]

export async function seedPackages(prisma: PrismaClient): Promise<number> {
  for (const item of PACKAGES) {
    await prisma.package.upsert({
      where: { code: item.code },
      update: { name: item.name, description: item.description, sort: item.sort },
      create: {
        name: item.name,
        code: item.code,
        description: item.description,
        accessType: item.accessType,
        trafficQuota: item.trafficQuota,
        bandwidthLimit: item.bandwidthLimit,
        domainLimit: item.domainLimit,
        requestQuota: item.requestQuota,
        featureFlags: item.featureFlags as Prisma.InputJsonValue,
        overQuotaPolicy: item.overQuotaPolicy,
        price: item.price,
        period: item.period,
        status: 1,
        sort: item.sort,
      },
    })
  }
  return PACKAGES.length
}
