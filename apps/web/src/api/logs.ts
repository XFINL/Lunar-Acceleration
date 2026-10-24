import { request } from './client'

export interface AccessLog {
  id: string
  domainId: string
  eventTime: string
  statusCode: number
  ip: string
  url: string
  userAgent: string | null
  bytes: string
  region?: string | null
  isp?: string | null
}
export interface AccessLogQuery {
  domainId?: string
  startTime?: string
  endTime?: string
  statusCode?: string
  ip?: string
  url?: string
  userAgent?: string
  page: number
  pageSize: number
}
export interface AccessLogPage { page: number; pageSize: number; list: AccessLog[] }
export const logsApi = {
  listAccess: (params: AccessLogQuery) => request.get<AccessLogPage>('/user/logs/access', { params }),
  exportAccess: (params: Omit<AccessLogQuery, 'page' | 'pageSize'>) =>
    request.get<Blob>('/user/logs/access/export', { params, responseType: 'blob' }),
}
