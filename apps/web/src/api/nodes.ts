import { request } from './client'

export interface NodeRecord {
  id: string
  name: string
  ip: string
  port: number
  region?: string | null
  isp?: string | null
  nodeGroupId?: string | null
  weight?: number | null
  bandwidthMbps?: number | null
  status?: string | number | null
  lastHeartbeatAt?: string | null
  lastHeartbeat?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface NodePayload {
  name: string
  ip: string
  port: number
  region?: string
  isp?: string
  nodeGroupId?: string
  weight?: number
  bandwidthMbps?: number
}

export interface NodeMetric {
  timestamp?: string
  time?: string
  recordedAt?: string
  statTime?: string
  cpu?: number | string | null
  cpuUsage?: number | string | null
  cpuPercent?: number | string | null
  mem?: number | string | null
  memoryUsage?: number | string | null
  memoryPercent?: number | string | null
  disk?: number | string | null
  bandwidthMbps?: number | string | null
  inboundMbps?: number | string | null
  outboundMbps?: number | string | null
  bandwidthIn?: number | string | null
  bandwidthOut?: number | string | null
  connections?: number | string | null
  qps?: number | string | null
  cacheHitRate?: number | string | null
  [key: string]: unknown
}

export type NodeMetricResponse = NodeMetric[] | { list?: NodeMetric[]; metrics?: NodeMetric[] }

export const adminNodeApi = {
  list: () => request.get<NodeRecord[] | { list?: NodeRecord[] }>('/admin/nodes'),
  create: (data: NodePayload) => request.post<NodeRecord & { nodeToken?: string; token?: string }>('/admin/nodes', data),
  rotateToken: (id: string) => request.post<{ nodeToken?: string; token?: string }>(`/admin/nodes/${encodeURIComponent(id)}/rotate-token`),
  metrics: (id: string) => request.get<NodeMetricResponse>(`/admin/nodes/${encodeURIComponent(id)}/metrics`),
}
