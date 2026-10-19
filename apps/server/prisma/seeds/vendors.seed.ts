import type { PrismaClient } from '@prisma/client'

/** 只在首次创建内置厂商；重复初始化不得恢复被管理员停用的厂商。 */
export async function seedVendors(prisma: PrismaClient): Promise<number> {
  const vendors = [
    { name: 'Cloudflare', code: 'cloudflare', driver: 'CloudflareDriver', description: '只读连接与自定义域名清单；同步不代表部署。', sort: 10 },
    { name: '阿里云 CDN', code: 'ali', driver: 'AliDriver', description: '只读连接与 CDN 域名清单；使用最小权限 RAM 凭据。', sort: 20 },
  ]
  for (const vendor of vendors) await prisma.vendor.upsert({ where: { code: vendor.code }, update: {}, create: vendor })
  return vendors.length
}
