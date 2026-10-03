import type { Pagination } from '@lunar/shared'

export interface PaginatedResult<T> {
  list: T[]
  pagination: Pagination
}

export function buildPagination(page: number, pageSize: number, total: number): Pagination {
  return {
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
  }
}

export function paginate<T>(list: T[], page: number, pageSize: number, total: number): PaginatedResult<T> {
  return { list, pagination: buildPagination(page, pageSize, total) }
}
