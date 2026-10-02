import type { RoleType } from '@lunar/shared'
import { request } from './client'
import type {
  AdminUserDetail,
  AdminUserItem,
  AuditLogItem,
  Paginated,
  PermissionItem,
  RoleDetail,
  RoleItem,
} from './types'

export interface AdminUserQuery {
  page?: number
  pageSize?: number
  keyword?: string
  status?: number
  roleType?: number
}

export interface CreateUserPayload {
  username: string
  password: string
  email?: string
  nickname?: string
  roleType?: RoleType
  roleCodes?: string[]
}

export const adminApi = {
  // 用户管理
  listUsers: (params: AdminUserQuery) =>
    request.get<Paginated<AdminUserItem>>('/admin/users', { params }),
  getUser: (id: string) => request.get<AdminUserDetail>(`/admin/users/${id}`),
  createUser: (data: CreateUserPayload) =>
    request.post<{ id: string }>('/admin/users', data),
  updateUser: (
    id: string,
    data: { nickname?: string; email?: string; phone?: string; status?: number; roleType?: RoleType },
  ) => request.put<AdminUserItem>(`/admin/users/${id}`, data),
  deleteUser: (id: string) => request.delete<{ id: string }>(`/admin/users/${id}`),
  banUser: (id: string) => request.post<{ id: string }>(`/admin/users/${id}/ban`),
  unbanUser: (id: string) => request.post<{ id: string }>(`/admin/users/${id}/unban`),
  resetPassword: (id: string, password?: string) =>
    request.post<{ id: string; password: string }>(`/admin/users/${id}/reset-password`, { password }),
  adjustBalance: (id: string, data: { amount: number; remark?: string }) =>
    request.post<{ id: string; balance: string }>(`/admin/users/${id}/balance`, data),

  // 角色与权限
  listRoles: () => request.get<RoleItem[]>('/admin/roles'),
  getRole: (id: string) => request.get<RoleDetail>(`/admin/roles/${id}`),
  createRole: (data: { name: string; code: string; description?: string }) =>
    request.post<{ id: string }>('/admin/roles', data),
  updateRole: (id: string, data: { name?: string; description?: string }) =>
    request.put<{ id: string }>(`/admin/roles/${id}`, data),
  deleteRole: (id: string) => request.delete<{ id: string }>(`/admin/roles/${id}`),
  listPermissions: () => request.get<PermissionItem[]>('/admin/permissions'),
  assignPermissions: (id: string, permissionCodes: string[]) =>
    request.put<{ id: string }>(`/admin/roles/${id}/perms`, { permissionCodes }),
  assignUserRoles: (id: string, roleCodes: string[]) =>
    request.put<{ userId: string }>(`/admin/users/${id}/roles`, { roleCodes }),

  // 审计
  listAuditLogs: (params: {
    page?: number
    pageSize?: number
    module?: string
    userId?: string
    startTime?: string
    endTime?: string
  }) => request.get<Paginated<AuditLogItem>>('/admin/audit-logs', { params }),
}
