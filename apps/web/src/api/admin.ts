import type { RoleType } from '@lunar/shared'
import { request } from './client'
import type {
  AdminOrderDetailVo,
  AdminOrderVo,
  AdminUserDetail,
  AdminUserItem,
  AuditLogItem,
  OrderActionResult,
  PackageVo,
  Paginated,
  PermissionItem,
  RoleDetail,
  RoleItem,
  SiteConfigVo,
  TransactionVo,
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

export interface AdminPackageQuery {
  page?: number
  pageSize?: number
  status?: number
  keyword?: string
}

/** 创建 / 更新套餐入参（trafficQuota 单位为字节，requestQuota 为次数） */
export interface PackagePayload {
  name: string
  code: string
  description?: string
  accessType: number
  trafficQuota?: number
  bandwidthLimit?: number
  domainLimit?: number
  requestQuota?: number
  featureFlags?: string
  overQuotaPolicy?: number
  price?: string
  period?: number
  status?: number
  sort?: number
}

export interface AdminOrderQuery {
  page?: number
  pageSize?: number
  status?: number
  keyword?: string
  userId?: string
}

export interface TransactionQuery {
  page?: number
  pageSize?: number
  userId?: string
}

export interface ConfigItemPayload {
  configKey: string
  configValue: unknown
  description?: string
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

  // M2 套餐管理
  listPackages: (params: AdminPackageQuery) =>
    request.get<Paginated<PackageVo>>('/admin/packages', { params }),
  createPackage: (data: PackagePayload) => request.post<{ id: string }>('/admin/packages', data),
  getPackage: (id: string) => request.get<PackageVo>(`/admin/packages/${id}`),
  updatePackage: (id: string, data: PackagePayload) =>
    request.put<{ id: string }>(`/admin/packages/${id}`, data),
  deletePackage: (id: string) => request.delete<{ id: string }>(`/admin/packages/${id}`),
  updatePackageStatus: (id: string, status: number) =>
    request.put<{ id: string; status: number }>(`/admin/packages/${id}/status`, { status }),
  assignUserPackage: (id: string, data: { packageId: string; period?: number }) =>
    request.post<{ userId: string; packageId: string; expireAt: string }>(
      `/admin/users/${id}/package`,
      data,
    ),

  // M2 订单管理
  listOrders: (params: AdminOrderQuery) =>
    request.get<Paginated<AdminOrderVo>>('/admin/orders', { params }),
  getOrder: (id: string) => request.get<AdminOrderDetailVo>(`/admin/orders/${id}`),
  refundOrder: (id: string) =>
    request.post<OrderActionResult>(`/admin/orders/${id}/refund`),

  // M2 资金流水
  listTransactions: (params: TransactionQuery) =>
    request.get<Paginated<TransactionVo>>('/admin/transactions', { params }),

  // M2 站点配置
  getSiteConfig: () => request.get<{ items: SiteConfigVo[] }>('/admin/site-config'),
  updateSiteConfig: (group: string, items: ConfigItemPayload[]) =>
    request.put<{ count: number }>(`/admin/site-config/${group}`, { items }),

  // M2 系统配置
  getSystemConfig: () => request.get<{ items: SiteConfigVo[] }>('/admin/system-config'),
  updateSystemConfig: (group: string, items: ConfigItemPayload[]) =>
    request.put<{ count: number }>(`/admin/system-config/${group}`, { items }),
}
