import type { PrismaClient } from '@prisma/client'
import { RoleCode, RoleType, UserStatus } from '@lunar/shared'
import { hashPassword } from '../../src/common/utils/password.util'

/**
 * 初始超级管理员（仅首次创建时写入密码，重复执行不会覆盖已有账号密码）
 */
export async function seedAdminUser(prisma: PrismaClient): Promise<string> {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin'
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123456'

  let user = await prisma.user.findUnique({ where: { username } })
  if (!user) {
    user = await prisma.user.create({
      data: {
        username,
        nickname: '超级管理员',
        passwordHash: await hashPassword(password),
        roleType: RoleType.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        inviteCode: 'ADMIN001',
      },
    })
  }

  const role = await prisma.role.findUnique({ where: { code: RoleCode.SUPER_ADMIN } })
  if (role) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    })
  }

  return username
}
