import type { Request } from 'express'

/**
 * 获取客户端真实 IP（信任反向代理的 X-Forwarded-For）
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]
  }
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown'
}

export function getUserAgent(request: Request): string {
  return (request.headers['user-agent'] as string | undefined) ?? ''
}
