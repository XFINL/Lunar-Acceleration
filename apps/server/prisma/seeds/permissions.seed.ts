import type { PrismaClient } from '@prisma/client'
import { PERMISSIONS, PERMISSION_NAME_MAP } from '@lunar/shared'

/** 同步权限点（以 @lunar/shared 的 PERMISSIONS 为准） */
export async function seedPermissions(prisma: PrismaClient): Promise<number> {
  for (const code of PERMISSIONS) {
    const [resource, action] = code.split(':')
    const name = PERMISSION_NAME_MAP[code] ?? code
    await prisma.permission.upsert({
      where: { code },
      update: { name, resource, action },
      create: { code, name, resource, action },
    })
  }
  return PERMISSIONS.length
}
