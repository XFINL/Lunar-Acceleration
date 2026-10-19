import { request } from './client'

export interface Domain {
  id: string
  domain: string
  cname: string
  status: number
  auditStatus: number
  accessType?: number
  businessType?: string
  remark?: string
  createdAt: string
}
export interface Pagination { page: number; pageSize: number; total: number }
export interface DomainPage { list: Domain[]; pagination: Pagination }
export interface InitialOrigin { address: string; port: number; weight: number; protocol: string; host?: string; isBackup?: boolean }
export interface InitialOriginGroup { name: string; lbPolicy: 'round_robin' | 'weighted' | 'least_conn' | 'primary_backup'; origins: InitialOrigin[] }
export interface DomainPayload { domain: string; businessType?: string; remark?: string; tags?: string[]; originGroup?: InitialOriginGroup }
export interface DomainConfig { defaultTtl?: number; originProtocol?: string; originHost?: string }
export interface DomainCheck { expectedCname: string; observedCnames: string[]; matched: boolean; checkedAt: string }
export interface CacheRule {
  id: string; name: string; matchType: 'path' | 'extension' | 'all' | 'file_type' | 'status' | 'header' | 'query'; matchValue: string
  matchMode: 'exact' | 'prefix' | 'suffix' | 'contains' | 'regex'; action: 'cache' | 'bypass' | 'force_cache'; ttl: number
  ignoreParams: boolean; status?: number; cacheKey?: string
}
export interface Origin { id: string; address: string; port: number; weight: number; protocol: string; host: string; status: number }
export interface OriginGroup { id: string; name: string; lbPolicy: string; origins: Origin[] }
export interface OriginGroupPayload { name: string; lbPolicy: string; origins: InitialOrigin[] }
export interface HttpsConfig { certId?: string | null; httpsEnabled: boolean; forceHttps: boolean; hstsEnabled: boolean; hstsMaxAge: number; tlsVersion: string }

export const domainApi = {
  list: (params: { page?: number; pageSize?: number }) => request.get<DomainPage>('/user/domains', { params }),
  create: (data: DomainPayload) => request.post<Domain>('/user/domains', data),
  get: (id: string) => request.get<Domain>(`/user/domains/${id}`),
  update: (id: string, data: Partial<DomainPayload>) => request.put<Domain>(`/user/domains/${id}`, data),
  remove: (id: string) => request.delete<{ id: string }>(`/user/domains/${id}`),
  getConfig: (id: string) => request.get<DomainConfig>(`/user/domains/${id}/config`),
  updateConfig: (id: string, data: DomainConfig) => request.put<DomainConfig>(`/user/domains/${id}/config`, data),
  check: (id: string) => request.post<DomainCheck>(`/user/domains/${id}/check`),
  enable: (id: string) => request.post<{ id: string }>(`/user/domains/${id}/enable`),
  disable: (id: string) => request.post<{ id: string }>(`/user/domains/${id}/disable`),
  batch: (action: 'delete' | 'disable' | 'check', ids: string[]) => request.post<{ results: Array<{ id: string; success?: boolean; error?: string; [key: string]: unknown }> }>('/user/domains/batch', { action, ids }),
  listCacheRules: async (id: string) => {
    const result = await request.get<{ list: CacheRule[] } | CacheRule[]>(`/user/domains/${id}/cache-rules`)
    return Array.isArray(result) ? result : result.list
  },
  createCacheRule: (id: string, data: Omit<CacheRule, 'id'>) => request.post<CacheRule>(`/user/domains/${id}/cache-rules`, data),
  updateCacheRule: (id: string, ruleId: string, data: Partial<CacheRule>) => request.put<CacheRule>(`/user/domains/${id}/cache-rules/${ruleId}`, data),
  removeCacheRule: (id: string, ruleId: string) => request.delete<{ id: string }>(`/user/domains/${id}/cache-rules/${ruleId}`),
  sortCacheRules: (id: string, ruleIds: string[]) => request.put<{ success: boolean }>(`/user/domains/${id}/cache-rules/sort`, { ruleIds }),
  listOrigins: (id: string) => request.get<{ groups: OriginGroup[] }>(`/user/domains/${id}/origins`),
  createOriginGroup: (id: string, data: OriginGroupPayload) => request.post<OriginGroup>(`/user/domains/${id}/origins`, data),
  updateOrigin: (id: string, originId: string, data: Partial<Origin> & { isBackup?: boolean }) => request.put<Origin>(`/user/domains/${id}/origins/${originId}`, data),
  removeOrigin: (id: string, originId: string) => request.delete<{ id: string }>(`/user/domains/${id}/origins/${originId}`),
  deleteOriginGroup: (id: string, groupId: string) => request.delete<{ deleted: boolean }>(`/user/domains/${id}/origin-groups/${groupId}`),
  addOriginsToGroup: (id: string, groupId: string, origins: InitialOrigin[]) => request.post<unknown>(`/user/domains/${id}/origin-groups/${groupId}/origins`, { origins }),
  healthCheck: (id: string, groupId: string) => request.post<{ results: Array<{ id: string; status: 'healthy' | 'unhealthy' | 'blocked' | 'error' | string; latency?: number; statusCode?: number; [key: string]: unknown }> }>(`/user/domains/${id}/origins/health-check`, { groupId }),
  updateOriginGroup: (id: string, groupId: string, data: { name: string; lbPolicy: string; healthCheck?: unknown }) => request.put<OriginGroup>(`/user/domains/${id}/origin-groups/${groupId}`, data),
  bindCertificate: (id: string, certId: string | null) => request.put<{ id: string; certId: string | null }>(`/user/domains/${id}/cert`, { certId }),
  getHttps: (id: string) => request.get<HttpsConfig>(`/user/domains/${id}/https`),
  updateHttps: (id: string, data: HttpsConfig) => request.put<HttpsConfig>(`/user/domains/${id}/https`, data),
}

export const adminDomainApi = {
  list: (params: { page?: number; pageSize?: number }) => request.get<DomainPage>('/admin/domains', { params }),
  audit: (params: { page?: number; pageSize?: number }) => request.get<DomainPage>('/admin/domains/audit', { params }),
  approve: (id: string, remark?: string) => request.post<Domain>(`/admin/domains/${id}/approve`, { remark }),
  reject: (id: string, remark?: string) => request.post<Domain>(`/admin/domains/${id}/reject`, { remark }),
  offline: (id: string) => request.post<Domain>(`/admin/domains/${id}/offline`),
}
