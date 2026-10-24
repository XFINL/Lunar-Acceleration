import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { Public } from '../../common/decorators/public.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import { NodeHmacGuard } from './node-hmac.guard'
import { NodeService } from './node.service'
import {
  CreateNodeDto, UpdateNodeDto, CreateNodeGroupDto, UpdateNodeGroupDto,
  HeartbeatDto, ReportNodeMetricsDto, NodeListQueryDto, NodeMetricQueryDto,
} from './node.dto'

@ApiTags('管理员 - 节点')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('admin/nodes')
export class AdminNodeController {
  constructor(private readonly service: NodeService) {}

  @Get()
  @RequirePermissions('node:read')
  @ApiOperation({ summary: '分页列出节点，不返回任何令牌或 token hash' })
  list(@Query() query: NodeListQueryDto) { return this.service.listNodes(query) }

  @Post()
  @RequirePermissions('node:create')
  @ApiOperation({ summary: '创建节点；原始 token 仅在此响应显示一次' })
  create(@Body() input: CreateNodeDto) { return this.service.createNode(input) }

  @Get(':id/metrics')
  @RequirePermissions('node:read')
  @ApiOperation({ summary: '分页查看节点监控指标' })
  metrics(@Param('id') id: string, @Query() query: NodeMetricQueryDto) { return this.service.listMetrics(id, query) }

  @Post(':id/rotate-token')
  @RequirePermissions('node:update')
  @ApiOperation({ summary: '轮换节点令牌；新 token 仅在此响应显示一次' })
  rotateToken(@Param('id') id: string) { return this.service.rotateToken(id) }

  @Get(':id')
  @RequirePermissions('node:read')
  @ApiOperation({ summary: '查看节点详情（不返回令牌或 token hash）' })
  get(@Param('id') id: string) { return this.service.getNode(id) }

  @Put(':id')
  @RequirePermissions('node:update')
  update(@Param('id') id: string, @Body() input: UpdateNodeDto) { return this.service.updateNode(id, input) }

  @Delete(':id')
  @RequirePermissions('node:delete')
  remove(@Param('id') id: string) { return this.service.deleteNode(id) }
}

@ApiTags('管理员 - 节点组')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('admin/node-groups')
export class AdminNodeGroupController {
  constructor(private readonly service: NodeService) {}

  @Get()
  @RequirePermissions('node:read')
  list() { return this.service.listGroups() }

  @Post()
  @RequirePermissions('node:create')
  create(@Body() input: CreateNodeGroupDto) { return this.service.createGroup(input) }

  @Put(':id')
  @RequirePermissions('node:update')
  update(@Param('id') id: string, @Body() input: UpdateNodeGroupDto) { return this.service.updateGroup(id, input) }

  @Delete(':id')
  @RequirePermissions('node:delete')
  remove(@Param('id') id: string) { return this.service.deleteGroup(id) }
}

@ApiTags('节点通信')
@Controller('node')
@Public()
@UseGuards(NodeHmacGuard)
export class NodeCommunicationController {
  constructor(private readonly service: NodeService) {}

  @Post('heartbeat')
  @ApiOperation({ summary: '提交经过节点 HMAC 验证的一次性 nonce 心跳' })
  heartbeat(@Req() request: Request & { nodeId?: bigint }, @Body() input: HeartbeatDto) {
    return this.service.heartbeat(request.nodeId!, input)
  }

  @Post('report-metrics')
  @ApiOperation({ summary: '提交经过节点 HMAC 验证的监控数据' })
  metrics(@Req() request: Request & { nodeId?: bigint }, @Body() input: ReportNodeMetricsDto) {
    return this.service.recordMetrics(request.nodeId!, input)
  }
}
