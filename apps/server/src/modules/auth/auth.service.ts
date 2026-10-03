import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { ErrorCode, RoleCode, RoleType, UserStatus } from '@lunar/shared'
import svgCaptcha from 'svg-captcha'
import { randomUUID } from 'crypto'
import type { JwtConfig, ThrottleConfig } from '../../config/configuration'
import { BusinessException } from '../../common/exceptions/business.exception'
import type { AuthUser, JwtPayload } from '../../common/interfaces/auth-user.interface'
import { hashPassword, verifyPassword } from '../../common/utils/password.util'
import { PrismaService } from '../../database/prisma.service'
import { RedisService } from '../../shared/redis/redis.service'
import { RbacService } from '../rbac/rbac.service'
import type { LoginDto, RegisterDto } from './dto/auth.dto'

const CAPTCHA_PREFIX = 'captcha:'
const CAPTCHA_TTL = 300
const LOGIN_FAIL_PREFIX = 'login-fail:'
const REFRESH_PREFIX = 'refresh:'

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rbacService: RbacService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ============ 验证码 ============

  async createCaptcha(): Promise<{ captchaId: string; image: string }> {
    const captcha = svgCaptcha.create({
      size: 4,
      noise: 3,
      color: true,
      ignoreChars: '0o1ilI',
      width: 120,
      height: 40,
    })
    const captchaId = randomUUID()
    await this.redis.set(`${CAPTCHA_PREFIX}${captchaId}`, captcha.text.toLowerCase(), CAPTCHA_TTL)
    return {
      captchaId,
      image: `data:image/svg+xml;base64,${Buffer.from(captcha.data).toString('base64')}`,
    }
  }

  private async assertCaptcha(captchaId?: string, captcha?: string): Promise<void> {
    if (!captchaId || !captcha) {
      throw new BusinessException(ErrorCode.CAPTCHA_INVALID)
    }
    const key = `${CAPTCHA_PREFIX}${captchaId}`
    const expected = await this.redis.get(key)
    if (!expected || expected !== captcha.toLowerCase()) {
      throw new BusinessException(ErrorCode.CAPTCHA_INVALID)
    }
    await this.redis.del(key)
  }

  // ============ 登录 / 注册 ============

  async login(dto: LoginDto, ip: string, ua: string) {
    await this.assertCaptcha(dto.captchaId, dto.captcha)
    await this.assertNotLocked(dto.username)

    const user = await this.prisma.user.findFirst({
      where: { username: dto.username, deletedAt: null },
    })

    if (!user || !(await verifyPassword(dto.password, user.passwordHash))) {
      await this.recordLoginFailure(dto.username)
      await this.writeLoginLog({
        userId: user?.id ?? null,
        username: dto.username,
        ip,
        ua,
        status: 0,
        message: '用户名或密码错误',
      })
      throw new BusinessException(ErrorCode.CREDENTIALS_INVALID)
    }

    if (user.status === UserStatus.DISABLED) {
      await this.writeLoginLog({
        userId: user.id,
        username: user.username,
        ip,
        ua,
        status: 0,
        message: '账号已禁用',
      })
      throw new BusinessException(ErrorCode.ACCOUNT_DISABLED)
    }

    await this.redis.del(`${LOGIN_FAIL_PREFIX}${dto.username}`)
    await this.writeLoginLog({
      userId: user.id,
      username: user.username,
      ip,
      ua,
      status: 1,
      message: '登录成功',
    })

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip },
    })

    const authUser = await this.buildAuthUser(user.id.toString())
    const tokens = await this.issueTokens(authUser, dto.remember === true)

    return {
      ...tokens,
      user: this.toProfile(authUser),
    }
  }

  async register(dto: RegisterDto, ip: string, ua: string) {
    await this.assertCaptcha(dto.captchaId, dto.captcha)

    const duplicate = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: dto.username },
          ...(dto.email ? [{ email: dto.email }] : []),
        ],
        deletedAt: null,
      },
      select: { username: true, email: true },
    })
    if (duplicate) {
      if (duplicate.username === dto.username) {
        throw new BusinessException(ErrorCode.USERNAME_EXISTS)
      }
      throw new BusinessException(ErrorCode.EMAIL_EXISTS)
    }

    let inviterId: bigint | null = null
    if (dto.inviteCode) {
      const inviter = await this.prisma.user.findFirst({
        where: { inviteCode: dto.inviteCode, deletedAt: null },
        select: { id: true },
      })
      if (!inviter) {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '邀请码无效')
      }
      inviterId = inviter.id
    }

    const passwordHash = await hashPassword(dto.password)
    const inviteCode = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: dto.username,
          email: dto.email ?? null,
          passwordHash,
          nickname: dto.username,
          status: UserStatus.ACTIVE,
          roleType: RoleType.USER,
          inviteCode,
          inviterId,
        },
      })
      const defaultRole = await tx.role.findUnique({ where: { code: RoleCode.USER } })
      if (defaultRole) {
        await tx.userRole.create({ data: { userId: user.id, roleId: defaultRole.id } })
      }
      return user
    })

    await this.writeLoginLog({
      userId: created.id,
      username: created.username,
      ip,
      ua,
      status: 1,
      message: '注册成功',
    })

    const authUser = await this.buildAuthUser(created.id.toString())
    const tokens = await this.issueTokens(authUser, false)
    return { ...tokens, user: this.toProfile(authUser) }
  }

  async refresh(refreshToken: string) {
    const jwtConfig = this.configService.get<JwtConfig>('jwt')!
    let payload: JwtPayload & { jti?: string }
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: jwtConfig.refreshSecret,
      })
    } catch {
      throw new BusinessException(ErrorCode.TOKEN_EXPIRED)
    }

    if (!payload?.sub || !payload.jti) {
      throw new BusinessException(ErrorCode.TOKEN_INVALID)
    }

    const key = `${REFRESH_PREFIX}${payload.sub}:${payload.jti}`
    const stored = await this.redis.get(key)
    if (!stored) {
      throw new BusinessException(ErrorCode.TOKEN_INVALID)
    }

    // 轮换：旧 refresh token 立即失效
    await this.redis.del(key)

    const authUser = await this.buildAuthUser(payload.sub)
    const tokens = await this.issueTokens(authUser, false)
    return tokens
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      try {
        const jwtConfig = this.configService.get<JwtConfig>('jwt')!
        const payload = await this.jwtService.verifyAsync<JwtPayload & { jti?: string }>(
          refreshToken,
          { secret: jwtConfig.refreshSecret },
        )
        if (payload?.jti) {
          await this.redis.del(`${REFRESH_PREFIX}${payload.sub}:${payload.jti}`)
        }
      } catch {
        // 忽略无效 token
      }
      return
    }
    await this.redis.delByPrefix(`${REFRESH_PREFIX}${userId}:`)
  }

  // ============ 用户上下文 ============

  async buildAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: BigInt(userId), deletedAt: null },
    })
    if (!user) throw new BusinessException(ErrorCode.UNAUTHORIZED)
    if (user.status === UserStatus.DISABLED) {
      throw new BusinessException(ErrorCode.ACCOUNT_DISABLED)
    }

    const [permissions, roles] = await Promise.all([
      this.rbacService.getPermissionsByUserId(userId, user.roleType),
      this.rbacService.getRoleCodesByUserId(userId),
    ])

    return {
      id: user.id.toString(),
      username: user.username,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      roleType: user.roleType as RoleType,
      status: user.status,
      balance: user.balance.toFixed(2),
      packageId: user.packageId?.toString() ?? null,
      packageExpireAt: user.packageExpireAt?.toISOString() ?? null,
      permissions,
      roles,
    }
  }

  toProfile(user: AuthUser) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      roleType: user.roleType,
      roles: user.roles,
      permissions: user.permissions,
      balance: user.balance,
      packageId: user.packageId,
      packageExpireAt: user.packageExpireAt,
    }
  }

  // ============ 内部工具 ============

  private async issueTokens(user: AuthUser, remember: boolean): Promise<TokenPair> {
    const jwtConfig = this.configService.get<JwtConfig>('jwt')!
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      roleType: user.roleType,
    }
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: jwtConfig.secret,
      expiresIn: jwtConfig.expiresIn,
    })

    const jti = randomUUID()
    const refreshToken = await this.jwtService.signAsync(
      { ...payload, jti },
      { secret: jwtConfig.refreshSecret, expiresIn: jwtConfig.refreshExpiresIn },
    )

    const ttlSeconds = this.parseDuration(jwtConfig.refreshExpiresIn) * (remember ? 2 : 1)
    await this.redis.set(`${REFRESH_PREFIX}${user.id}:${jti}`, '1', ttlSeconds)

    return {
      accessToken,
      refreshToken,
      expiresIn: this.parseDuration(jwtConfig.expiresIn),
    }
  }

  /** 解析 2h / 7d / 3600 这类时长，返回秒 */
  private parseDuration(value: string): number {
    const match = /^(\d+)([smhd])?$/.exec(value.trim())
    if (!match) return 7200
    const amount = Number.parseInt(match[1], 10)
    const unit = match[2] ?? 's'
    const factor: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
    return amount * factor[unit]
  }

  private async assertNotLocked(username: string): Promise<void> {
    const throttle = this.configService.get<ThrottleConfig>('throttle')!
    const failures = Number.parseInt(
      (await this.redis.get(`${LOGIN_FAIL_PREFIX}${username}`)) ?? '0',
      10,
    )
    if (failures >= throttle.loginLimit) {
      throw new BusinessException(ErrorCode.TOO_MANY_REQUESTS, '登录失败次数过多，请稍后再试')
    }
  }

  private async recordLoginFailure(username: string): Promise<void> {
    await this.redis.incrWithTtl(`${LOGIN_FAIL_PREFIX}${username}`, 1800)
  }

  private async writeLoginLog(input: {
    userId: bigint | null
    username: string
    ip: string
    ua: string
    status: number
    message: string
  }): Promise<void> {
    try {
      await this.prisma.userLoginLog.create({
        data: {
          userId: input.userId,
          username: input.username,
          ip: input.ip,
          ua: input.ua.slice(0, 512),
          status: input.status,
          message: input.message,
        },
      })
    } catch (error) {
      this.logger.warn(`写入登录日志失败: ${(error as Error).message}`)
    }
  }
}
