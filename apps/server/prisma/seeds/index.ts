import { PrismaClient } from '@prisma/client'
import { seedAdminUser } from './admin-user.seed'
import { seedPackages } from './packages.seed'
import { seedPaymentChannels } from './payment-channels.seed'
import { seedPermissions } from './permissions.seed'
import { seedRoles } from './roles.seed'
import { seedSiteConfigs } from './site-configs.seed'
import { seedSystemConfigs } from './system-configs.seed'

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  try {
    const permissionCount = await seedPermissions(prisma)
    const roleCount = await seedRoles(prisma)
    const siteConfigCount = await seedSiteConfigs(prisma)
    const systemConfigCount = await seedSystemConfigs(prisma)
    const packageCount = await seedPackages(prisma)
    const paymentChannelCount = await seedPaymentChannels(prisma)
    const adminUsername = await seedAdminUser(prisma)

    console.log('[seed] 权限点:', permissionCount)
    console.log('[seed] 内置角色:', roleCount)
    console.log('[seed] 网站配置:', siteConfigCount)
    console.log('[seed] 系统配置:', systemConfigCount)
    console.log('[seed] 套餐:', packageCount)
    console.log('[seed] 支付渠道:', paymentChannelCount)
    console.log(`[seed] 初始管理员: ${adminUsername}（默认密码见 SEED_ADMIN_PASSWORD）`)
    console.log('[seed] 完成')
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch((error: unknown) => {
  console.error('[seed] 失败:', error)
  process.exit(1)
})
