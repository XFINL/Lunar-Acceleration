import { request } from './client'
import type { Pagination } from './domain'

export interface CertificateMetadata {
  id: string; name: string; issuer: string; notBefore: string; notAfter: string; hasPrivateKey: boolean; autoRenew?: boolean
}
export interface CertificatePage { list: CertificateMetadata[]; pagination: Pagination }

export interface AcmeChallengeRecord {
  name: string
  value: string
  domain: string
}

export interface AcmeChallenge {
  type: 'dns-01'
  records: AcmeChallengeRecord[]
}

export type AcmeJobStatus = 'needs_dns' | 'processing' | 'issued' | 'failed' | 'pending'

export interface AcmeJobDomain {
  id: string
  domain: string
  autoRenew: boolean
}

export interface AcmeJob {
  id: string
  status: AcmeJobStatus
  domains: AcmeJobDomain[]
  challenge: AcmeChallenge | null
  certificateId: string | null
  expiresAt: string | null
  error: string | null
  createdAt: string
  updatedAt: string
  instructions?: string
}

export const certificateApi = {
  list: (params: { page?: number; pageSize?: number }) => request.get<CertificatePage>('/user/certificates', { params }),
  upload: (data: { name: string; certPem: string; keyPem: string }) => request.post<CertificateMetadata>('/user/certificates', data),
  get: (id: string) => request.get<CertificateMetadata>(`/user/certificates/${id}`),
  remove: (id: string) => request.delete<{ id: string }>(`/user/certificates/${id}`),
  apply: (data: { domainId: string; autoRenew?: boolean }) => request.post<AcmeJob>('/user/certificates/apply', data),
  renew: (id: string) => request.post<AcmeJob>(`/user/certificates/${id}/renew`, {}),
  getJob: (id: string) => request.get<AcmeJob>(`/user/certificate-jobs/${id}`),
  completeJob: (id: string) => request.post<AcmeJob>(`/user/certificate-jobs/${id}/complete`, {}),
}
