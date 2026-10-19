import { request } from './client'

export type VendorWriteAction = 'register' | 'delete'
export type VendorWriteJobStatus = 'queued' | 'running' | 'retry_wait' | 'succeeded' | 'failed' | 'needs_review' | string

export interface VendorWriteCapabilities {
  writesEnabled: boolean
  workerEnabled: boolean
  [key: string]: unknown
}

export interface VendorWriteJob {
  id: string
  action: VendorWriteAction
  status: VendorWriteJobStatus
  domainId: string
  vendorAccountId: string
  attempts: number
  message: string | null
  errorCode?: string | null
  retryable?: boolean
  createdAt: string
  updatedAt: string
  nextAttemptAt?: string | null
  externalId?: string | null
  domain?: { id: string; domain: string }
}

export interface VendorWriteJobPage {
  list: VendorWriteJob[]
  pagination: { page: number; pageSize: number; total: number }
}

export interface CreateVendorWriteJobPayload {
  action: VendorWriteAction
  domainId: string
  idempotencyKey: string
}

export const vendorWriteApi = {
  capabilities: () => request.get<VendorWriteCapabilities>('/admin/vendor-write-capabilities'),
  listAccountJobs: (accountId: string, params: { page: number; pageSize: number }) =>
    request.get<VendorWriteJobPage>(`/admin/vendor-accounts/${encodeURIComponent(accountId)}/write-jobs`, { params }),
  createAccountJob: (accountId: string, payload: CreateVendorWriteJobPayload) =>
    request.post<VendorWriteJob>(`/admin/vendor-accounts/${encodeURIComponent(accountId)}/write-jobs`, payload),
  retryJob: (jobId: string) =>
    request.post<VendorWriteJob>(`/admin/vendor-write-jobs/${encodeURIComponent(jobId)}/retry`),
}
