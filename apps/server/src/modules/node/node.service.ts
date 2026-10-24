import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../database/prisma.service'
import { sha256Hex } from './node-hmac.util'
import type {
  CreateNodeDto, UpdateNodeDto, CreateNodeGroupDto, UpdateNodeGroupDto,
  HeartbeatDto, ReportNodeMetricsDto, NodeListQueryDto, NodeMetricQueryDto,
} from './node.dto'

const UINT64_MAX = 18446744073709551615n
const NODE_SELECT = {
  id: true, name: true, ip: true, port: true, region: true, isp: true,
  nodeGroupId: true, status: true, weight: true, version: true, cpuCores: true,
  memoryMb: true, diskGb: true, bandwidthMbps: true, lastHeartbeat: true,
  createdAt: true, updatedAt: true,
} as const

export function parseUnsignedId(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,19})$/.test(value)) throw new BadRequestException('invalid id')
  const id = BigInt(value)
  if (id < 1n || id > UINT64_MAX) throw new BadRequestException('invalid id')
  return id
}

function publicNode<T extends { id: bigint; nodeGroupId?: bigint | null }>(node: T) {
  return { ...node, id: node.id.toString(), ...(node.nodeGroupId !== undefined ? { nodeGroupId: node.nodeGroupId?.toString() ?? null } : {}) }
}

function tokenOnce<T>(node: T, token: string) {
  return { ...node, token }
}

@Injectable()
export class NodeService {
  constructor(private readonly prisma: PrismaService) {}

  async createNode(input: CreateNodeDto) {
    const rawToken = randomBytes(32).toString('base64url')
    const tokenHash = sha256Hex(rawToken)
    const groupId = input.nodeGroupId ? parseUnsignedId(input.nodeGroupId) : null
    if (groupId && !(await this.prisma.nodeGroup.findUnique({ where: { id: groupId }, select: { id: true } }))) {
      throw new NotFoundException('node group not found')
    }
    const node = await this.prisma.$transaction(async (tx) => {
      const created = await tx.node.create({
        data: {
          name: input.name, ip: input.ip, port: input.port ?? 443,
          region: input.region, isp: input.isp, nodeGroupId: groupId,
          weight: input.weight ?? 1, bandwidthMbps: input.bandwidthMbps, status: 2,
        },
        select: NODE_SELECT,
      })
      await tx.nodeToken.create({ data: { nodeId: created.id, tokenHash, status: 1 } })
      return created
    })
    return tokenOnce(publicNode(node), rawToken)
  }

  async listNodes(query: NodeListQueryDto) {
    const where: Prisma.NodeWhereInput = {
      ...(query.keyword ? { OR: [{ name: { contains: query.keyword } }, { ip: { contains: query.keyword } }] } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.region ? { region: query.region } : {}),
      ...(query.nodeGroupId !== undefined ? { nodeGroupId: parseUnsignedId(String(query.nodeGroupId)) } : {}),
    }
    const [list, total] = await this.prisma.$transaction([
      this.prisma.node.findMany({ where, select: NODE_SELECT, orderBy: { [query.sort === 'name' ? 'name' : 'createdAt']: query.order }, skip: query.skip, take: query.take }),
      this.prisma.node.count({ where }),
    ])
    return { list: list.map(publicNode), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } }
  }

  async getNode(idText: string) {
    const id = parseUnsignedId(idText)
    const node = await this.prisma.node.findUnique({
      where: { id }, select: { ...NODE_SELECT, group: { select: { id: true, name: true, region: true } } },
    })
    if (!node) throw new NotFoundException('node not found')
    const metrics = await this.readMetrics(id, 10, 0, 'desc')
    return {
      ...publicNode(node),
      group: node.group ? { ...node.group, id: node.group.id.toString() } : null,
      metrics: metrics.map((metric) => this.metricView(metric)),
    }
  }

  async updateNode(idText: string, input: UpdateNodeDto) {
    const id = parseUnsignedId(idText)
    const existing = await this.prisma.node.findUnique({ where: { id }, select: { id: true } })
    if (!existing) throw new NotFoundException('node not found')
    const data: Prisma.NodeUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.ip !== undefined ? { ip: input.ip } : {}),
      ...(input.port !== undefined ? { port: input.port } : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.isp !== undefined ? { isp: input.isp } : {}),
      ...(input.weight !== undefined ? { weight: input.weight } : {}),
      ...(input.bandwidthMbps !== undefined ? { bandwidthMbps: input.bandwidthMbps } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    }
    if (input.nodeGroupId !== undefined) {
      const groupId = input.nodeGroupId === null ? null : parseUnsignedId(input.nodeGroupId)
      if (groupId && !(await this.prisma.nodeGroup.findUnique({ where: { id: groupId }, select: { id: true } }))) throw new NotFoundException('node group not found')
      data.group = groupId ? { connect: { id: groupId } } : { disconnect: true }
    }
    return publicNode(await this.prisma.node.update({ where: { id }, data, select: NODE_SELECT }))
  }

  async deleteNode(idText: string) {
    const id = parseUnsignedId(idText)
    try { await this.prisma.node.delete({ where: { id } }) } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new NotFoundException('node not found')
      throw error
    }
    return { id: id.toString() }
  }

  async rotateToken(idText: string) {
    const nodeId = parseUnsignedId(idText)
    const rawToken = randomBytes(32).toString('base64url')
    const tokenHash = sha256Hex(rawToken)
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: NODE_SELECT })
    if (!node) throw new NotFoundException('node not found')
    await this.prisma.nodeToken.upsert({
      where: { nodeId },
      create: { nodeId, tokenHash, status: 1 },
      update: { tokenHash, status: 1, expireAt: null },
    })
    return tokenOnce(publicNode(node), rawToken)
  }

  async heartbeat(nodeId: bigint, heartbeat: HeartbeatDto) {
    const existing = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { id: true, status: true } })
    if (!existing) throw new NotFoundException('node not found')
    const updated = await this.prisma.node.update({
      where: { id: nodeId },
      data: {
        version: heartbeat.version,
        ...(heartbeat.cpuCores !== undefined ? { cpuCores: heartbeat.cpuCores } : {}),
        ...(heartbeat.memoryMb !== undefined ? { memoryMb: heartbeat.memoryMb } : {}),
        ...(heartbeat.diskGb !== undefined ? { diskGb: heartbeat.diskGb } : {}),
        lastHeartbeat: new Date(),
        ...(existing.status === 3 ? {} : { status: 1 }),
      }, select: NODE_SELECT,
    })
    return { accepted: true, nodeId: updated.id.toString(), status: updated.status, lastHeartbeat: updated.lastHeartbeat }
  }

  async recordMetrics(nodeId: bigint, input: ReportNodeMetricsDto) {
    if (!(await this.prisma.node.findUnique({ where: { id: nodeId }, select: { id: true } }))) throw new NotFoundException('node not found')
    await this.prisma.$transaction(async (tx) => {
      for (const metric of input.metrics) {
        await tx.$executeRaw(Prisma.sql`INSERT INTO node_metrics (node_id,stat_time,cpu_usage,mem_usage,disk_usage,bandwidth_in,bandwidth_out,connections,qps,cache_hit_rate) VALUES (CAST(${nodeId.toString()} AS UNSIGNED),${new Date(metric.time)},${metric.cpu ?? null},${metric.mem ?? null},${metric.disk ?? null},CAST(CAST(${metric.bandwidthIn ?? null} AS DECIMAL(20,0)) AS UNSIGNED),CAST(CAST(${metric.bandwidthOut ?? null} AS DECIMAL(20,0)) AS UNSIGNED),${metric.connections ?? null},${metric.qps ?? null},${metric.cacheHitRate ?? null})`)
      }
    })
    return { accepted: input.metrics.length }
  }

  async listMetrics(idText: string, query: NodeMetricQueryDto) {
    const nodeId = parseUnsignedId(idText)
    if (!(await this.prisma.node.findUnique({ where: { id: nodeId }, select: { id: true } }))) throw new NotFoundException('node not found')
    const [list, total] = await Promise.all([
      this.readMetrics(nodeId, query.take, query.skip, query.order),
      this.prisma.nodeMetric.count({ where: { nodeId } }),
    ])
    return { list: list.map((metric) => this.metricView(metric)), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } }
  }

  private readMetrics(nodeId: bigint, take: number, skip: number, order: 'asc' | 'desc') {
    const direction = order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`
    return this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT CAST(id AS CHAR) AS id,CAST(node_id AS CHAR) AS nodeId,stat_time AS statTime,cpu_usage AS cpuUsage,mem_usage AS memUsage,disk_usage AS diskUsage,CAST(bandwidth_in AS CHAR) AS bandwidthIn,CAST(bandwidth_out AS CHAR) AS bandwidthOut,CAST(connections AS CHAR) AS connections,CAST(qps AS CHAR) AS qps,cache_hit_rate AS cacheHitRate FROM node_metrics WHERE node_id=CAST(${nodeId.toString()} AS UNSIGNED) ORDER BY stat_time ${direction},id ${direction} LIMIT ${take} OFFSET ${skip}`)
  }

  private metricView(metric: Record<string, unknown>) {
    return { ...metric, id: String(metric.id), nodeId: String(metric.nodeId), bandwidthIn: metric.bandwidthIn == null ? null : String(metric.bandwidthIn), bandwidthOut: metric.bandwidthOut == null ? null : String(metric.bandwidthOut) }
  }

  async createGroup(input: CreateNodeGroupDto) {
    const row = await this.prisma.nodeGroup.create({ data: input })
    return { ...row, id: row.id.toString() }
  }

  async listGroups() {
    const groups = await this.prisma.nodeGroup.findMany({ orderBy: { id: 'asc' }, include: { _count: { select: { nodes: true } } } })
    return groups.map((group) => ({ ...group, id: group.id.toString() }))
  }

  async updateGroup(idText: string, input: UpdateNodeGroupDto) {
    const id = parseUnsignedId(idText)
    try { const row = await this.prisma.nodeGroup.update({ where: { id }, data: input }); return { ...row, id: row.id.toString() } } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new NotFoundException('node group not found')
      throw error
    }
  }

  async deleteGroup(idText: string) {
    const id = parseUnsignedId(idText)
    const row = await this.prisma.nodeGroup.findUnique({ where: { id }, select: { id: true } })
    if (!row) throw new NotFoundException('node group not found')
    await this.prisma.nodeGroup.delete({ where: { id } })
    return { id: id.toString() }
  }

  /** Online nodes past this explicit cutoff become offline; maintenance state is never changed. */
  async markStaleNodesOffline(cutoff: Date): Promise<number> {
    const result = await this.prisma.node.updateMany({ where: { status: 1, lastHeartbeat: { lt: cutoff } }, data: { status: 2 } })
    return result.count
  }

  /** Nonces are retained for ten minutes to make replay prevention durable across instances/restarts. */
  async cleanupExpiredNonces(now = new Date()): Promise<number> {
    const result = await this.prisma.nodeRequestNonce.deleteMany({ where: { expiresAt: { lte: now } } })
    return result.count
  }

  @Cron('*/30 * * * * *')
  async schedulerTick(): Promise<void> {
    const now = new Date()
    await Promise.all([
      this.markStaleNodesOffline(new Date(now.getTime() - 120_000)),
      this.cleanupExpiredNonces(now),
    ])
  }
}
