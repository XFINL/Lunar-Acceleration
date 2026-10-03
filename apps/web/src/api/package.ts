import { request } from './client'
import type { MyPackageVo, PackageVo, Paginated } from './types'

export interface PackageQuery {
  page?: number
  pageSize?: number
  keyword?: string
}

export const packageApi = {
  /** 套餐列表（仅上架套餐） */
  listPackages: (params: PackageQuery) =>
    request.get<Paginated<PackageVo>>('/user/packages', { params }),
  /** 套餐详情 */
  getPackage: (id: string) => request.get<PackageVo>(`/user/packages/${id}`),
  /** 我的当前套餐，未购套餐时为 null */
  getMyPackage: () => request.get<MyPackageVo | null>('/user/my-package'),
}
