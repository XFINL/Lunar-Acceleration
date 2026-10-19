import { Injectable } from '@nestjs/common'
import { Prisma, type Package } from '@prisma/client'
import {
  ErrorCode,
  OverQuotaPolicy,
  PackageAccessType,
  PackagePeriod,
  PackageStatus,
  UserPackageStatus,
} from '@lunar/shared'
import { BusinessException } from '../../common/exceptions/business.exception'
import { PrismaService } from '../../database/prisma.service'

export interface PackageQuery {
  page: number
  pageSize: number
  keyword?: string
  status?: number
}

export interface PackageCreateData {
  name: string
  code: string
  description?: string
  accessType: number
  vendorId?: string | null
  trafficQuota?: number
  bandwidthLimit?: number
  domainLimit?: number
  requestQuota?: number
  featureFlags?: unknown
  overQuotaPolicy?: number
  price?: number
  period?: number
  status?: number
  sort?: number
}

export interface PackageUpdateData {
  name?: string
  code?: string
  description?: string
  accessType?: number
  vendorId?: string | null
  trafficQuota?: number
  bandwidthLimit?: number
  domainLimit?: number
  requestQuota?: number
  featureFlags?: unknown
  overQuotaPolicy?: number
  price?: number
  period?: number
  status?: number
  sort?: number
}

@Injectable()
export class PackageService {
  constructor(private readonly prisma: PrismaService) {}

  // ============ 用户端 ============

  async listOnline(query: PackageQuery) {
    const where: Prisma.PackageWhereInput = { status: PackageStatus.ONLINE }
    if (query.keyword) where.name = { contains: query.keyword }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.package.count({ where }),
      this.prisma.package.findMany({
        where,
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ])
    return { total, list: rows.map((row) => this.toPackageVo(row)) }
  }

  async getOnlineDetail(id: string) {
    const pkg = await this.prisma.package.findFirst({
      where: { id: BigInt(id), status: PackageStatus.ONLINE },
    })
    if (!pkg) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)
    return this.toPackageVo(pkg)
  }

  async getMyPackage(userId: string) {
    const record = await this.prisma.userPackage.findFirst({
      where: {
        userId: BigInt(userId),
        status: UserPackageStatus.ACTIVE,
        expireAt: { gt: new Date() },
      },
      orderBy: { expireAt: 'desc' },
      include: { package: true },
    })
    if (!record) return null

    return {
      id: record.id.toString(),
      packageId: record.packageId.toString(),
      name: record.package.name,
      code: record.package.code,
      startAt: record.startAt,
      expireAt: record.expireAt,
      trafficUsed: record.trafficUsed.toString(),
      trafficQuota: record.trafficQuota.toString(),
      requestUsed: record.requestUsed.toString(),
      requestQuota: record.requestQuota.toString(),
      domainLimit: record.package.domainLimit,
      bandwidthLimit: record.package.bandwidthLimit,
      status: record.status,
      featureFlags: record.package.featureFlags,
    }
  }

  // ============ 管理员端 ============

  async adminList(query: PackageQuery) {
    const where: Prisma.PackageWhereInput = {}
    if (query.status !== undefined) where.status = query.status
    if (query.keyword) {
      where.OR = [{ name: { contains: query.keyword } }, { code: { contains: query.keyword } }]
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.package.count({ where }),
      this.prisma.package.findMany({
        where,
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ])
    return { total, list: rows.map((row) => this.toPackageVo(row)) }
  }

  async adminGetPackage(id: string) {
    const pkg = await this.requirePackage(id)
    return this.toPackageVo(pkg)
  }

  async adminCreatePackage(data: PackageCreateData) {
    const exists = await this.prisma.package.findUnique({ where: { code: data.code } })
    if (exists) throw new BusinessException(ErrorCode.PARAM_INVALID, '套餐标识已存在')

    const vendorId = await this.validateVendorMapping(data.accessType, data.vendorId)

    const created = await this.prisma.package.create({
      data: {
        name: data.name,
        code: data.code,
        description: data.description ?? null,
        accessType: data.accessType,
        vendorId,
        trafficQuota: BigInt(Math.trunc(data.trafficQuota ?? 0)),
        bandwidthLimit: data.bandwidthLimit ?? 0,
        domainLimit: data.domainLimit ?? 0,
        requestQuota: BigInt(Math.trunc(data.requestQuota ?? 0)),
        featureFlags: this.toJsonInput(data.featureFlags),
        overQuotaPolicy: data.overQuotaPolicy ?? OverQuotaPolicy.LIMIT_SPEED,
        price: new Prisma.Decimal(data.price ?? 0),
        period: data.period ?? PackagePeriod.MONTH,
        status: data.status ?? PackageStatus.ONLINE,
        sort: data.sort ?? 0,
      },
    })
    return { id: created.id.toString() }
  }

  async adminUpdatePackage(id: string, data: PackageUpdateData) {
    const current = await this.requirePackage(id)

    if (data.code) {
      const dup = await this.prisma.package.findFirst({
        where: { code: data.code, id: { not: BigInt(id) } },
      })
      if (dup) throw new BusinessException(ErrorCode.PARAM_INVALID, '套餐标识已存在')
    }

    const nextAccessType = data.accessType ?? current.accessType
    const mappingProvided = data.vendorId !== undefined
    const nextVendorId = mappingProvided
      ? await this.validateVendorMapping(nextAccessType, data.vendorId)
      : current.vendorId
    if (nextAccessType === PackageAccessType.SELF_NODE && nextVendorId !== null) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '自建节点套餐必须清除厂商映射')
    }
    if (current.vendorId !== nextVendorId && (await this.hasActiveManagedResources(current.id))) {
      throw new BusinessException(
        ErrorCode.PARAM_INVALID,
        '套餐已有用户的启用域名关联面板托管厂商资源，不能更换或清除厂商映射',
      )
    }

    const updated = await this.prisma.package.update({
      where: { id: BigInt(id) },
      data: {
        name: data.name,
        code: data.code,
        description: data.description,
        accessType: data.accessType,
        vendorId: mappingProvided ? nextVendorId : undefined,
        trafficQuota:
          data.trafficQuota === undefined ? undefined : BigInt(Math.trunc(data.trafficQuota)),
        bandwidthLimit: data.bandwidthLimit,
        domainLimit: data.domainLimit,
        requestQuota:
          data.requestQuota === undefined ? undefined : BigInt(Math.trunc(data.requestQuota)),
        featureFlags: data.featureFlags === undefined ? undefined : this.toJsonInput(data.featureFlags),
        overQuotaPolicy: data.overQuotaPolicy,
        price: data.price === undefined ? undefined : new Prisma.Decimal(data.price),
        period: data.period,
        status: data.status,
        sort: data.sort,
      },
    })
    return this.toPackageVo(updated)
  }

  async adminDeletePackage(id: string) {
    await this.requirePackage(id)

    const [orderCount, userPackageCount] = await this.prisma.$transaction([
      this.prisma.order.count({ where: { packageId: BigInt(id) } }),
      this.prisma.userPackage.count({ where: { packageId: BigInt(id) } }),
    ])
    if (orderCount > 0 || userPackageCount > 0) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '套餐已被使用，无法删除')
    }

    await this.prisma.package.delete({ where: { id: BigInt(id) } })
    return { id }
  }

  async adminSetStatus(id: string, status: number) {
    await this.requirePackage(id)
    await this.prisma.package.update({ where: { id: BigInt(id) }, data: { status } })
    return { id, status }
  }

  async assignPackage(userId: string, packageId: string, period?: number) {
    const user = await this.prisma.user.findFirst({
      where: { id: BigInt(userId), deletedAt: null },
    })
    if (!user) throw new BusinessException(ErrorCode.USER_NOT_FOUND)

    const pkg = await this.prisma.package.findUnique({ where: { id: BigInt(packageId) } })
    if (!pkg) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)

    const assignedPeriod = period ?? pkg.period

    // Concurrent assignments for different users can still conflict at the
    // database level (e.g. while updating shared indexes). Retry the entire
    // transaction only for Prisma's serialization/deadlock signal; never retry
    // business errors or hide a failed assignment.
    const maxAttempts = 3
    let expireAt: Date | undefined
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        expireAt = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`)
          const eligibleUser = await tx.user.findFirst({
            where: { id: user.id, deletedAt: null },
            select: { id: true },
          })
          if (!eligibleUser) throw new BusinessException(ErrorCode.USER_NOT_FOUND)

          const transactionStartAt = new Date()
          const transactionExpireAt = this.addUtcMonths(
            transactionStartAt,
            this.periodMonths(assignedPeriod),
          )
          await tx.userPackage.updateMany({
            where: { userId: user.id, status: UserPackageStatus.ACTIVE },
            data: { status: UserPackageStatus.CANCELLED },
          })
          await tx.userPackage.create({
            data: {
              userId: user.id,
              packageId: pkg.id,
              startAt: transactionStartAt,
              expireAt: transactionExpireAt,
              trafficQuota: pkg.trafficQuota,
              requestQuota: pkg.requestQuota,
              status: UserPackageStatus.ACTIVE,
            },
          })
          await tx.user.update({
            where: { id: user.id },
            data: { packageId: pkg.id, packageExpireAt: transactionExpireAt },
          })
          return transactionExpireAt
        })
        break
      } catch (error) {
        if ((error as { code?: string })?.code !== 'P2034' || attempt === maxAttempts - 1) {
          throw error
        }
        // A small bounded backoff lets the competing transaction release its
        // locks before the complete assignment is retried.
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)))
      }
    }
    // The loop either returns a transaction result or throws on its final
    // failure; this guard also keeps the inferred result non-optional.
    if (!expireAt) throw new Error('Package assignment transaction did not complete')

    return { userId, packageId, expireAt }
  }

  // ============ 内部 ============

  private async requirePackage(id: string) {
    const pkg = await this.prisma.package.findUnique({ where: { id: BigInt(id) } })
    if (!pkg) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)
    return pkg
  }

  private async validateVendorMapping(accessType: number, vendorId?: string | null) {
    if (![PackageAccessType.SELF_NODE, PackageAccessType.VENDOR, PackageAccessType.HYBRID].includes(accessType)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '套餐接入类型无效')
    }
    if (accessType === PackageAccessType.SELF_NODE) {
      if (vendorId !== undefined && vendorId !== null && vendorId !== '') {
        throw new BusinessException(ErrorCode.PARAM_INVALID, '自建节点套餐不能配置厂商映射')
      }
      return null
    }
    if (vendorId === undefined || vendorId === null || vendorId === '') return null
    if (!/^\d+$/.test(vendorId)) {
      throw new BusinessException(ErrorCode.PARAM_INVALID, '厂商 ID 无效')
    }
    const parsedVendorId = BigInt(vendorId)
    if (parsedVendorId <= 0n) throw new BusinessException(ErrorCode.PARAM_INVALID, '厂商 ID 无效')
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: parsedVendorId, status: 1 },
      select: { id: true },
    })
    if (!vendor) throw new BusinessException(ErrorCode.PARAM_INVALID, '厂商不存在或未启用')
    return parsedVendorId
  }

  private async hasActiveManagedResources(packageId: bigint) {
    const resource = await this.prisma.vendorResource.findFirst({
      where: {
        managedByPanel: true,
        domain: {
          user: { packageId },
        },
      },
      select: { id: true },
    })
    return resource !== null
  }

  /** 套餐周期：1月 2季(3月) 3年；UTC日历加月并截断至月底。 */
  private periodMonths(period: number): number {
    if (period === PackagePeriod.QUARTER) return 3
    if (period === PackagePeriod.YEAR) return 12
    return 1
  }

  private addUtcMonths(start: Date, months: number): Date {
    const date = new Date(start)
    const day = date.getUTCDate()
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + months)
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(day, lastDay))
    return date
  }

  private toJsonInput(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    if (value === null || value === undefined) return Prisma.JsonNull
    return value as Prisma.InputJsonValue
  }

  private toPackageVo(pkg: Package) {
    return {
      id: pkg.id.toString(),
      name: pkg.name,
      code: pkg.code,
      description: pkg.description,
      accessType: pkg.accessType,
      vendorId: pkg.vendorId?.toString() ?? null,
      trafficQuota: pkg.trafficQuota.toString(),
      bandwidthLimit: pkg.bandwidthLimit,
      domainLimit: pkg.domainLimit,
      requestQuota: pkg.requestQuota.toString(),
      featureFlags: pkg.featureFlags,
      overQuotaPolicy: pkg.overQuotaPolicy,
      price: pkg.price.toFixed(2),
      period: pkg.period,
      status: pkg.status,
      sort: pkg.sort,
      createdAt: pkg.createdAt,
      updatedAt: pkg.updatedAt,
    }
  }
}
