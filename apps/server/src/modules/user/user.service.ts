import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { ErrorCode, RoleCode, RoleType, UserStatus } from '@lunar/shared'
import type { SecurityConfig } from '../../config/configuration'
import { BusinessException } from '../../common/exceptions/business.exception'
import { decrypt, encrypt, randomHex } from '../../common/utils/crypto.util'
import { hashPassword, isStrongPassword, verifyPassword } from '../../common/utils/password.util'
import { PrismaService } from '../../database/prisma.service'
import { RbacService } from '../rbac/rbac.service'

export interface AdminUserQuery {
  page: number
  pageSize: number
  keyword?: string
  status?: number
  roleType?: number
}

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
    private readonly configService: ConfigService,
  ) {}

  private get encryptionKey(): string {
    return this.configService.get<SecurityConfig>('security')!.encryptionKey
  }

  // ============ 个人中心 ============

  async getProfile(userId: string) {
    const user = await this.requireUser(userId)
    return this.toUserVo(user)
  }

  async updateProfile(userId: string, data: { nickname?: string; avatar?: string; email?: string }) {
    if (data.email) {
      const exists = await this.prisma.user.findFirst({
        where: { email: data.email, id: { not: BigInt(userId) }, deletedAt: null },
      })
      if (exists) throw new BusinessException(ErrorCode.EMAIL_EXISTS)
    }
    const user = await this.prisma.user.update({
      where: { id: BigInt(userId) },
      data: { nickname: data.nickname, avatar: data.avatar, email: data.email },
    })
    return this.toUserVo(user)
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.requireUser(userId)
    if (!(await verifyPassword(oldPassword, user.passwordHash))) {
      throw new BusinessException(ErrorCode.CREDENTIALS_INVALID, '原密码错误')
    }
    if (!isStrongPassword(newPassword)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '新密码需 8-32 位且包含大小写字母与数字')
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    })
    return { success: true }
  }

  async listLoginLogs(userId: string, page: number, pageSize: number) {
    const where: Prisma.UserLoginLogWhereInput = { userId: BigInt(userId) }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.userLoginLog.count({ where }),
      this.prisma.userLoginLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return {
      total,
      list: rows.map((row) => ({
        id: row.id.toString(),
        ip: row.ip,
        region: row.region,
        ua: row.ua,
        status: row.status,
        message: row.message,
        createdAt: row.createdAt,
      })),
    }
  }

  // ============ API 密钥 ============

  async listApiKeys(userId: string) {
    const rows = await this.prisma.userApiKey.findMany({
      where: { userId: BigInt(userId) },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((row) => ({
      id: row.id.toString(),
      name: row.name,
      accessKey: row.accessKey,
      status: row.status,
      expireAt: row.expireAt,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
    }))
  }

  async createApiKey(userId: string, name: string) {
    const accessKey = `AK${randomHex(12).toUpperCase()}`
    const secretKey = randomHex(24)
    const created = await this.prisma.userApiKey.create({
      data: {
        userId: BigInt(userId),
        name,
        accessKey,
        secretKey: encrypt(secretKey, this.encryptionKey),
      },
    })
    // SecretKey 仅创建时返回一次
    return { id: created.id.toString(), name: created.name, accessKey, secretKey }
  }

  async updateApiKey(userId: string, id: string, data: { name?: string; status?: number }) {
    await this.requireApiKey(userId, id)
    const updated = await this.prisma.userApiKey.update({
      where: { id: BigInt(id) },
      data: { name: data.name, status: data.status },
    })
    return { id: updated.id.toString() }
  }

  async removeApiKey(userId: string, id: string) {
    await this.requireApiKey(userId, id)
    await this.prisma.userApiKey.delete({ where: { id: BigInt(id) } })
    return { id }
  }

  /** 解密 SecretKey（供签名校验使用） */
  async getDecryptedSecretKey(accessKey: string): Promise<{ userId: string; secretKey: string } | null> {
    const record = await this.prisma.userApiKey.findUnique({ where: { accessKey } })
    if (!record || record.status !== 1) return null
    if (record.expireAt && record.expireAt.getTime() < Date.now()) return null
    return {
      userId: record.userId.toString(),
      secretKey: decrypt(record.secretKey, this.encryptionKey),
    }
  }

  // ============ 管理员端 ============

  async adminList(query: AdminUserQuery) {
    const where: Prisma.UserWhereInput = { deletedAt: null }
    if (query.status !== undefined) where.status = query.status
    if (query.roleType !== undefined) where.roleType = query.roleType
    if (query.keyword) {
      where.OR = [
        { username: { contains: query.keyword } },
        { nickname: { contains: query.keyword } },
        { email: { contains: query.keyword } },
        { phone: { contains: query.keyword } },
      ]
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { userRoles: { include: { role: true } } },
      }),
    ])

    return {
      total,
      list: rows.map((row) => ({
        ...this.toUserVo(row),
        roles: row.userRoles.map((item) => item.role.code),
      })),
    }
  }

  async adminGetUser(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: BigInt(id), deletedAt: null },
      include: { userRoles: { include: { role: true } } },
    })
    if (!user) throw new BusinessException(ErrorCode.USER_NOT_FOUND)
    return {
      ...this.toUserVo(user),
      roles: user.userRoles.map((item) => item.role.code),
      permissions: await this.rbacService.getPermissionsByUserId(id, user.roleType),
    }
  }

  async adminCreateUser(data: {
    username: string
    password: string
    email?: string
    nickname?: string
    roleType?: RoleType
    roleCodes?: string[]
  }) {
    const exists = await this.prisma.user.findUnique({ where: { username: data.username } })
    if (exists) throw new BusinessException(ErrorCode.USERNAME_EXISTS)
    if (!isStrongPassword(data.password)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '密码需 8-32 位且包含大小写字母与数字')
    }

    const user = await this.prisma.user.create({
      data: {
        username: data.username,
        email: data.email ?? null,
        nickname: data.nickname ?? data.username,
        passwordHash: await hashPassword(data.password),
        roleType: data.roleType ?? RoleType.USER,
        status: UserStatus.ACTIVE,
        inviteCode: randomHex(4).toUpperCase(),
      },
    })

    const roleCodes = data.roleCodes?.length ? data.roleCodes : [RoleCode.USER]
    await this.rbacService.assignUserRoles(user.id.toString(), roleCodes)

    return { id: user.id.toString() }
  }

  async adminUpdateUser(
    id: string,
    data: { nickname?: string; email?: string; phone?: string; status?: number; roleType?: RoleType },
  ) {
    await this.requireUser(id)
    const updated = await this.prisma.user.update({
      where: { id: BigInt(id) },
      data: {
        nickname: data.nickname,
        email: data.email,
        phone: data.phone,
        status: data.status,
        roleType: data.roleType,
      },
    })
    await this.rbacService.invalidateUserPermissions(id)
    return this.toUserVo(updated)
  }

  async adminSetStatus(id: string, status: UserStatus) {
    await this.requireUser(id)
    await this.prisma.user.update({ where: { id: BigInt(id) }, data: { status } })
    await this.rbacService.invalidateUserPermissions(id)
    return { id, status }
  }

  async adminResetPassword(id: string, newPassword?: string) {
    await this.requireUser(id)
    const password = newPassword ?? `Ln${randomHex(5)}@1`
    if (!isStrongPassword(password)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '密码需 8-32 位且包含大小写字母与数字')
    }
    await this.prisma.user.update({
      where: { id: BigInt(id) },
      data: { passwordHash: await hashPassword(password) },
    })
    return { id, password }
  }

  async adminAdjustBalance(
    id: string,
    operatorId: string,
    amount: number,
    remark?: string,
  ) {
    const user = await this.requireUser(id)
    const balanceAfter = Number(user.balance) + amount
    if (balanceAfter < 0) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '余额不足，无法扣减')
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { balance: new Prisma.Decimal(balanceAfter.toFixed(2)) },
      }),
      this.prisma.userBalance.create({
        data: {
          userId: user.id,
          type: 4,
          amount: new Prisma.Decimal(amount.toFixed(2)),
          balanceAfter: new Prisma.Decimal(balanceAfter.toFixed(2)),
          refType: 'admin_adjust',
          remark,
          operatorId: BigInt(operatorId),
        },
      }),
    ])

    return { id, balance: balanceAfter.toFixed(2) }
  }

  async adminDeleteUser(id: string) {
    await this.requireUser(id)
    // 软删除
    await this.prisma.user.update({
      where: { id: BigInt(id) },
      data: { deletedAt: new Date(), status: UserStatus.DISABLED },
    })
    await this.rbacService.invalidateUserPermissions(id)
    return { id }
  }

  // ============ 内部 ============

  private async requireUser(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: BigInt(id), deletedAt: null },
    })
    if (!user) throw new BusinessException(ErrorCode.USER_NOT_FOUND)
    return user
  }

  private async requireApiKey(userId: string, id: string) {
    const record = await this.prisma.userApiKey.findFirst({
      where: { id: BigInt(id), userId: BigInt(userId) },
    })
    if (!record) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)
    return record
  }

  private toUserVo(user: {
    id: bigint
    username: string
    email: string | null
    phone: string | null
    nickname: string | null
    avatar: string | null
    status: number
    roleType: number
    balance: Prisma.Decimal
    packageId: bigint | null
    packageExpireAt: Date | null
    inviteCode: string | null
    lastLoginAt: Date | null
    lastLoginIp: string | null
    createdAt: Date
  }) {
    return {
      id: user.id.toString(),
      username: user.username,
      email: user.email,
      phone: user.phone,
      nickname: user.nickname,
      avatar: user.avatar,
      status: user.status,
      roleType: user.roleType,
      balance: user.balance.toFixed(2),
      packageId: user.packageId?.toString() ?? null,
      packageExpireAt: user.packageExpireAt,
      inviteCode: user.inviteCode,
      lastLoginAt: user.lastLoginAt,
      lastLoginIp: user.lastLoginIp,
      createdAt: user.createdAt,
    }
  }
}
