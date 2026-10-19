import { request } from './client'

export type VendorCode = 'cloudflare' | 'ali'
export interface Vendor {
  id: string
  name: string
  code: VendorCode
  driver: string
  status: 0 | 1
  description?: string
  sort: number
}
export interface VendorAccount {
  id: string
  vendorId: string
  name: string
  status: number
  accessKey: string
  secretKey: string
  hasAccessKey: boolean
  hasSecretKey: boolean
  config: { zoneId?: string }
  lastSyncAt?: string | null
  vendor?: { id: string; name: string; code: VendorCode }
}
export interface VendorLog {
  id: string
  action: string
  status: 1 | 2
  message: string
  createdAt: string
}
export interface VendorResource {
  id: string
  domainId: string
  vendorDomainId: string
  managedByPanel?: boolean
  resourceData: { hostname: string; cname: string; providerStatus: string; sslStatus?: string; observedOnly: boolean; registrationOnly?: boolean }
  syncedAt: string
  domain?: { id: string; domain: string }
}
export interface PageResult<T> {
  list: T[]
  pagination: { page: number; pageSize: number; total: number }
}
export interface VendorPayload {
  name: string
  code: VendorCode
  description?: string
  status?: number
  sort?: number
}
export interface VendorUpdatePayload {
  name?: string
  description?: string
  status?: number
  sort?: number
}
export interface VendorAccountCreatePayload {
  vendorId: string
  name: string
  accessKey: string
  secretKey?: string
  config: { zoneId?: string }
  status?: number
}
export interface VendorAccountUpdatePayload {
  name?: string
  accessKey?: string
  secretKey?: string
  config?: { zoneId?: string }
  status?: number
}
export interface VendorTestResult {
  connected: boolean
  provider: string
  checkedAt: string
  accountLabel?: string
  providerStatus?: string
}
export interface VendorSyncResult {
  synced: number
  ignored: number
  total: number
  message?: string
  readonly: true
}

const paginated = { page: 1, pageSize: 10 }

export const vendorApi = {
  listVendors: (params: { page?: number; pageSize?: number } = paginated) =>
    request.get<PageResult<Vendor>>('/admin/vendors', { params }),
  createVendor: (data: VendorPayload) => request.post<Vendor>('/admin/vendors', data),
  updateVendor: (id: string, data: VendorUpdatePayload) => request.put<Vendor>(`/admin/vendors/${id}`, data),
  deleteVendor: (id: string) => request.delete<{ id: string }>(`/admin/vendors/${id}`),
  listAccounts: (params: { page?: number; pageSize?: number; vendorId?: string } = paginated) =>
    request.get<PageResult<VendorAccount>>('/admin/vendor-accounts', { params }),
  createAccount: (data: VendorAccountCreatePayload) => request.post<VendorAccount>('/admin/vendor-accounts', data),
  updateAccount: (id: string, data: VendorAccountUpdatePayload) => request.put<VendorAccount>(`/admin/vendor-accounts/${id}`, data),
  deleteAccount: (id: string) => request.delete<{ id: string }>(`/admin/vendor-accounts/${id}`),
  testAccount: (id: string) => request.post<VendorTestResult>(`/admin/vendor-accounts/${id}/test`),
  syncAccount: (id: string) => request.post<VendorSyncResult>(`/admin/vendor-accounts/${id}/sync`),
  accountLogs: (id: string, params: { page?: number; pageSize?: number } = paginated) =>
    request.get<PageResult<VendorLog>>(`/admin/vendor-accounts/${id}/logs`, { params }),
  accountResources: (id: string, params: { page?: number; pageSize?: number } = paginated) =>
    request.get<PageResult<VendorResource>>(`/admin/vendor-accounts/${id}/resources`, { params }),
}
