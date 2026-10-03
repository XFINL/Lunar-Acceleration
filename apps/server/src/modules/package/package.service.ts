import { Injectable } from '@nestjs/common'
import { Prisma, type Package } from '@prisma/client'
import {
  ErrorCode,
  OverQuotaPolicy,
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
  vendorId?: string
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
  vendorId?: string
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
      trafficQuota: record.package.trafficQuota.toString(),
      requestUsed: record.requestUsed.toString(),
      requestQuota: record.package.requestQuota.toString(),
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

    const created = await this.prisma.package.create({
      data: {
        name: data.name,
        code: data.code,
        description: data.description ?? null,
        accessType: data.accessType,
        vendorId: data.vendorId ? BigInt(data.vendorId) : null,
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
    await this.requirePackage(id)

    if (data.code) {
      const dup = await this.prisma.package.findFirst({
        where: { code: data.code, id: { not: BigInt(id) } },
      })
      if (dup) throw new BusinessException(ErrorCode.PARAM_INVALID, '套餐标识已存在')
    }

    const updated = await this.prisma.package.update({
      where: { id: BigInt(id) },
      data: {
        name: data.name,
        code: data.code,
        description: data.description,
        accessType: data.accessType,
        vendorId: data.vendorId === undefined ? undefined : BigInt(data.vendorId),
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

    const startAt = new Date()
    const expireAt = this.computeExpireAt(startAt, period ?? pkg.period)

    await this.prisma.$transaction(async (tx) => {
      await tx.userPackage.create({
        data: {
          userId: user.id,
          packageId: pkg.id,
          startAt,
          expireAt,
          status: UserPackageStatus.ACTIVE,
        },
      })
      await tx.user.update({
        where: { id: user.id },
        data: { packageId: pkg.id, packageExpireAt: expireAt },
      })
    })

    return { userId, packageId, expireAt }
  }

  // ============ 内部 ============

  private async requirePackage(id: string) {
    const pkg = await this.prisma.package.findUnique({ where: { id: BigInt(id) } })
    if (!pkg) throw new BusinessException(ErrorCode.RECORD_NOT_FOUND)
    return pkg
  }

  /** 套餐周期：1月 2季(3月) 3年 */
  private computeExpireAt(start: Date, period: number): Date {
    const date = new Date(start)
    if (period === PackagePeriod.QUARTER) date.setMonth(date.getMonth() + 3)
    else if (period === PackagePeriod.YEAR) date.setFullYear(date.getFullYear() + 1)
    else date.setMonth(date.getMonth() + 1)
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
