import type { PrismaClient } from '@prisma/client'
import {
  ADMIN_EXCLUDED,
  OPS_EXTRA,
  PERMISSIONS,
  ROLE_NAME_MAP,
  RoleCode,
  USER_RESOURCES,
  type PermissionCode,
} from '@lunar/shared'

const ROLE_ORDER: RoleCode[] = [
  RoleCode.SUPER_ADMIN,
  RoleCode.ADMIN,
  RoleCode.OPS,
  RoleCode.USER,
  RoleCode.SUB_USER,
]

const USER_ACTIONS = ['create', 'read', 'update', 'delete']

/** 角色默认权限（见 03-api.md §2.3） */
function resolveRolePermissions(role: RoleCode): PermissionCode[] {
  switch (role) {
    case RoleCode.SUPER_ADMIN:
      return [...PERMISSIONS]
    case RoleCode.ADMIN:
      return PERMISSIONS.filter((code) => !ADMIN_EXCLUDED.includes(code))
    case RoleCode.OPS:
      return PERMISSIONS.filter(
        (code) => code.startsWith('node:') || code.startsWith('schedule:'),
      ).concat(OPS_EXTRA)
    case RoleCode.USER:
      return PERMISSIONS.filter((code) => {
        const [resource, action] = code.split(':')
        return (
          (USER_RESOURCES as readonly string[]).includes(resource) &&
          USER_ACTIONS.includes(action)
        )
      })
    case RoleCode.SUB_USER:
    default:
      return []
  }
}

/** 同步内置角色及其权限 */
export async function seedRoles(prisma: PrismaClient): Promise<number> {
  for (const code of ROLE_ORDER) {
    const name = ROLE_NAME_MAP[code]
    const role = await prisma.role.upsert({
      where: { code },
      update: { name, isSystem: 1 },
      create: { name, code, isSystem: 1, description: `${name}（系统内置）` },
    })

    const permissionCodes = resolveRolePermissions(code)
    const permissions = permissionCodes.length
      ? await prisma.permission.findMany({
          where: { code: { in: permissionCodes } },
          select: { id: true },
        })
      : []

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      ...(permissions.length
        ? [
            prisma.rolePermission.createMany({
              data: permissions.map((permission) => ({
                roleId: role.id,
                permissionId: permission.id,
              })),
            }),
          ]
        : []),
    ])
  }
  return ROLE_ORDER.length
}
