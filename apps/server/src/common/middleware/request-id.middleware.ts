import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'crypto'

/**
 * 为每个请求注入 X-Request-Id（优先使用上游传入），用于链路追踪
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(
    request: Request & { requestId?: string },
    response: Response,
    next: NextFunction,
  ): void {
    const incoming = request.headers['x-request-id']
    const requestId =
      (typeof incoming === 'string' && incoming.length > 0 ? incoming : undefined) ?? randomUUID()
    request.requestId = requestId
    response.setHeader('X-Request-Id', requestId)
    next()
  }
}
