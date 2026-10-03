import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../database/prisma.service'

export interface ConfigItemInput {
  configKey: string
  configValue?: unknown
  description?: string
}

export interface SiteConfigVo {
  groupKey: string
  configKey: string
  configValue: Prisma.JsonValue
  description: string | null
  updatedAt: Date
}

@Injectable()
export class SettingService {
  constructor(private readonly prisma: PrismaService) {}

  // ============ 网站配置 ============

  async getSiteConfigs(): Promise<SiteConfigVo[]> {
    const rows = await this.prisma.siteConfig.findMany({
      orderBy: [{ groupKey: 'asc' }, { configKey: 'asc' }],
    })
    return rows.map((row) => this.toSiteConfigVo(row))
  }

  async getSiteConfigGroup(group: string): Promise<SiteConfigVo[]> {
    const rows = await this.prisma.siteConfig.findMany({
      where: { groupKey: group },
      orderBy: { configKey: 'asc' },
    })
    return rows.map((row) => this.toSiteConfigVo(row))
  }

  async updateSiteConfigGroup(group: string, items: ConfigItemInput[]) {
    await Promise.all(
      items.map((item) =>
        this.prisma.siteConfig.upsert({
          where: { uk_group_key: { groupKey: group, configKey: item.configKey } },
          create: {
            groupKey: group,
            configKey: item.configKey,
            configValue: this.toJsonInput(item.configValue),
            description: item.description ?? null,
          },
          update: {
            configValue: this.toJsonInput(item.configValue),
            description: item.description,
          },
        }),
      ),
    )
    return { count: items.length }
  }

  async getPublicSiteConfig(group: string): Promise<Record<string, Prisma.JsonValue>> {
    const rows = await this.prisma.siteConfig.findMany({ where: { groupKey: group } })
    const result: Record<string, Prisma.JsonValue> = {}
    for (const row of rows) {
      result[row.configKey] = row.configValue
    }
    return result
  }

  // ============ 系统配置 ============

  async getSystemConfigs(): Promise<SiteConfigVo[]> {
    const rows = await this.prisma.systemConfig.findMany({
      orderBy: [{ groupKey: 'asc' }, { configKey: 'asc' }],
    })
    return rows.map((row) => this.toSiteConfigVo(row))
  }

  async getSystemConfigGroup(group: string): Promise<SiteConfigVo[]> {
    const rows = await this.prisma.systemConfig.findMany({
      where: { groupKey: group },
      orderBy: { configKey: 'asc' },
    })
    return rows.map((row) => this.toSiteConfigVo(row))
  }

  async updateSystemConfigGroup(group: string, items: ConfigItemInput[]) {
    await Promise.all(
      items.map((item) =>
        this.prisma.systemConfig.upsert({
          where: { uk_group_key: { groupKey: group, configKey: item.configKey } },
          create: {
            groupKey: group,
            configKey: item.configKey,
            configValue: this.toJsonInput(item.configValue),
            description: item.description ?? null,
          },
          update: {
            configValue: this.toJsonInput(item.configValue),
            description: item.description,
          },
        }),
      ),
    )
    return { count: items.length }
  }

  // ============ 内部 ============

  private toJsonInput(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    if (value === null || value === undefined) return Prisma.JsonNull
    return value as Prisma.InputJsonValue
  }

  private toSiteConfigVo(row: {
    groupKey: string
    configKey: string
    configValue: Prisma.JsonValue
    description: string | null
    updatedAt: Date
  }): SiteConfigVo {
    return {
      groupKey: row.groupKey,
      configKey: row.configKey,
      configValue: row.configValue,
      description: row.description,
      updatedAt: row.updatedAt,
    }
  }
}
