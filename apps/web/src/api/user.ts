import type { Paginated } from './types'
import { request } from './client'
import type { ApiKeyItem, CreatedApiKey, LoginLogItem, UserProfile } from './types'

export const userApi = {
  getProfile: () => request.get<UserProfile>('/user/profile'),
  updateProfile: (data: { nickname?: string; avatar?: string; email?: string }) =>
    request.put<UserProfile>('/user/profile', data),
  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    request.put<{ success: boolean }>('/user/password', data),
  loginLogs: (params: { page?: number; pageSize?: number }) =>
    request.get<Paginated<LoginLogItem>>('/user/login-logs', { params }),
  listApiKeys: () => request.get<ApiKeyItem[]>('/user/api-keys'),
  createApiKey: (data: { name: string }) => request.post<CreatedApiKey>('/user/api-keys', data),
  updateApiKey: (id: string, data: { name?: string; status?: number }) =>
    request.put<{ id: string }>(`/user/api-keys/${id}`, data),
  removeApiKey: (id: string) => request.delete<{ id: string }>(`/user/api-keys/${id}`),
}
