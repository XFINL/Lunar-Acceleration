/**
 * 统一响应结构（见 03-api.md §1.3）
 */
export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data?: T
  requestId?: string
}

export interface FieldError {
  field: string
  message: string
}

export interface ApiErrorResponse {
  code: number
  message: string
  errors?: FieldError[]
  requestId?: string
}

export interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PaginatedData<T> {
  list: T[]
  pagination: Pagination
}

export interface PageQuery {
  page?: number
  pageSize?: number
  sort?: string
  order?: 'asc' | 'desc'
  keyword?: string
  status?: number
}

/** 支持的语言 */
export const LOCALES = ['zh-TW', 'en', 'jp', 'de'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'zh-TW'
