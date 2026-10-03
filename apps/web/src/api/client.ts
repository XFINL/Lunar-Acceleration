import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { ErrorCode, type ApiErrorResponse, type ApiResponse, type FieldError } from '@lunar/shared'
import { useAuthStore } from '@/stores/auth'
import type { TokenPair } from './types'

const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

/** 统一业务异常（后端 200 + code != 0 或 HTTP 错误） */
export class ApiError extends Error {
  readonly code: number
  readonly errors?: FieldError[]

  constructor(code: number, message: string, errors?: FieldError[]) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.errors = errors
  }
}

const REFRESHABLE_CODES = new Set<number>([
  ErrorCode.UNAUTHORIZED,
  ErrorCode.TOKEN_EXPIRED,
  ErrorCode.TOKEN_INVALID,
])

export const http = axios.create({
  baseURL,
  timeout: 20_000,
  withCredentials: true,
})

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

let refreshPromise: Promise<TokenPair | null> | null = null

async function refreshSession(): Promise<TokenPair | null> {
  const { refreshToken } = useAuthStore.getState()
  if (!refreshToken) return null
  try {
    const response = await axios.post<ApiResponse<TokenPair>>(
      `${baseURL}/auth/refresh`,
      { refreshToken },
      { withCredentials: true },
    )
    const payload = response.data
    if (payload.code !== ErrorCode.SUCCESS || !payload.data) return null
    useAuthStore.getState().setTokens(payload.data)
    return payload.data
  } catch {
    return null
  }
}

function toApiError(error: AxiosError<ApiErrorResponse>): ApiError {
  const payload = error.response?.data
  if (payload && typeof payload.code === 'number') {
    return new ApiError(payload.code, payload.message, payload.errors)
  }
  return new ApiError(ErrorCode.INTERNAL_ERROR, error.message || '网络请求失败')
}

http.interceptors.response.use(
  (response) => {
    const payload = response.data as ApiResponse<unknown>
    if (payload && typeof payload === 'object' && 'code' in payload) {
      if (payload.code === ErrorCode.SUCCESS) {
        // 运行时返回已解包的业务数据，request 助手负责还原为具体类型
        return payload.data as unknown as AxiosResponse
      }
      throw new ApiError(payload.code, payload.message)
    }
    return payload as unknown as AxiosResponse
  },
  async (error: AxiosError<ApiErrorResponse>) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined
    const isAuthEndpoint = original?.url?.includes('/auth/')
    const code = error.response?.data?.code
    const status = error.response?.status
    const shouldRefresh =
      !isAuthEndpoint &&
      !original?._retried &&
      ((typeof code === 'number' && REFRESHABLE_CODES.has(code)) || status === 401)

    if (shouldRefresh) {
      if (!refreshPromise) {
        refreshPromise = refreshSession().finally(() => {
          refreshPromise = null
        })
      }
      const tokens = await refreshPromise
      if (tokens && original) {
        original._retried = true
        original.headers = { ...original.headers, Authorization: `Bearer ${tokens.accessToken}` }
        return http.request(original)
      }
      useAuthStore.getState().clear()
    }

    return Promise.reject(toApiError(error))
  },
)

/** 类型友好的请求助手：interceptor 已解包 data 字段 */
export const request = {
  get: <T>(url: string, config?: AxiosRequestConfig) => http.get(url, config) as Promise<T>,
  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    http.post(url, data, config) as Promise<T>,
  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    http.put(url, data, config) as Promise<T>,
  delete: <T>(url: string, config?: AxiosRequestConfig) => http.delete(url, config) as Promise<T>,
}
