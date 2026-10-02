import { Injectable } from '@nestjs/common'
import { ErrorCode, RoleCode, RoleType } from '@lunar/shared'
import { PrismaService } from '../../database/prisma.service'
import { RedisService } from '../../shared/redis/redis.service'
import { BusinessException } from '../../common/exceptions/business.exception'

const USER_PERMS_CACHE_PREFIX = 'user:perms:'
const USER_PERMS_TTL = 600

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * 查询用户权限点集合（超管返回全量），带 Redis 缓存
   */
  async getPermissionsByUserId(userId: string, roleType: number): Promise<string[]> {
    const cacheKey = `${USER_PERMS_CACHE_PREFIX}${userId}`
    const cached = await this.redis.getJson<string[]>(cacheKey)
    if (cached) return cached

    let permissions: string[]
    if (roleType === RoleType.SUPER_ADMIN) {
      const all = await this.prisma.permission.findMany({ select: { code: true } })
      permissions = all.map((item) => item.code)
    } else {
      const rows = await this.prisma.rolePermission.findMany({
        where: { role: { users: { some: { userId: BigInt(userId) } } } },
        select: { permission: { select: { code: true } } },
      })
      permissions = Array.from(new Set(rows.map((row) => row.permission.code)))
    }

    await this.redis.setJson(cacheKey, permissions, USER_PERMS_TTL)
    return permissions
  }

  /** 用户角色标识集合 */
  async getRoleCodesByUserId(userId: string): Promise<string[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId: BigInt(userId) },
      select: { role: { select: { code: true } } },
    })
    return rows.map((row) => row.role.code)
  }

  /** 清理用户权限缓存 */
  async invalidateUserPermissions(userId: string): Promise<void> {
    await this.redis.del(`${USER_PERMS_CACHE_PREFIX}${userId}`)
  }

  /** 清理所有用户权限缓存（角色权限变更时） */
  async invalidateAllUserPermissions(): Promise<void> {
    await this.redis.delByPrefix(USER_PERMS_CACHE_PREFIX)
  }

  // ============ 角色管理 ============

  async listRoles() {
    return this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { id: 'asc' }],
      include: {
        _count: { select: { permissions: true, users: true } },
      },
    })
  }

  async getRoleDetail(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: BigInt(id) },
      include: { permissions: { include: { permission: true } } },
    })
    if (!role) throw new BusinessException(ErrorCode.ROLE_NOT_FOUND)
    return {
      ...role,
      permissionCodes: role.permissions.map((item) => item.permission.code),
    }
  }

  async createRole(data: { name: string; code: string; description?: string }) {
    const exists = await this.prisma.role.findUnique({ where: { code: data.code } })
    if (exists) throw new BusinessException(ErrorCode.ROLE_EXISTS)
    return this.prisma.role.create({
      data: { name: data.name, code: data.code, description: data.description, isSystem: 0 },
    })
  }

  async updateRole(id: string, data: { name?: string; description?: string }) {
    await this.ensureRoleExists(id)
    return this.prisma.role.update({
      where: { id: BigInt(id) },
      data: { name: data.name, description: data.description },
    })
  }

  async removeRole(id: string) {
    const role = await this.ensureRoleExists(id)
    if (role.isSystem === 1) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '系统内置角色不可删除')
    }
    await this.prisma.role.delete({ where: { id: BigInt(id) } })
    await this.invalidateAllUserPermissions()
    return { id }
  }

  /** 分配权限（全量覆盖） */
  async assignPermissions(id: string, permissionCodes: string[]) {
    const role = await this.ensureRoleExists(id)
    if (role.code === RoleCode.SUPER_ADMIN) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '超级管理员权限不可修改')
    }

    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
      select: { id: true, code: true },
    })
    if (permissions.length !== permissionCodes.length) {
      const found = new Set(permissions.map((item) => item.code))
      const missing = permissionCodes.filter((code) => !found.has(code))
      throw new BusinessException(ErrorCode.PARAM_INVALID, `未知权限点: ${missing.join(', ')}`)
    }

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: BigInt(id) } }),
      this.prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: BigInt(id),
          permissionId: permission.id,
        })),
      }),
    ])

    await this.invalidateAllUserPermissions()
    return { id, permissionCodes }
  }

  async listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    })
  }

  /** 分配用户角色（全量覆盖） */
  async assignUserRoles(userId: string, roleCodes: string[]) {
    const roles = await this.prisma.role.findMany({
      where: { code: { in: roleCodes } },
      select: { id: true, code: true },
    })
    if (roles.length !== roleCodes.length) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '存在未知角色')
    }

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: BigInt(userId) } }),
      this.prisma.userRole.createMany({
        data: roles.map((role) => ({ userId: BigInt(userId), roleId: role.id })),
      }),
    ])

    await this.invalidateUserPermissions(userId)
    return { userId, roleCodes }
  }

  async getUserRoleCodes(userId: string): Promise<string[]> {
    return this.getRoleCodesByUserId(userId)
  }

  private async ensureRoleExists(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id: BigInt(id) } })
    if (!role) throw new BusinessException(ErrorCode.ROLE_NOT_FOUND)
    return role
  }
}
