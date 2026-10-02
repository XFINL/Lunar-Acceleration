import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import type { Request, Response } from 'express'
import { Observable, tap } from 'rxjs'

/**
 * 访问日志：方法、路径、状态码、耗时、IP、UA（见 05-backend.md §10.4）
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP')

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp()
    const request = http.getRequest<Request & { requestId?: string }>()
    const response = http.getResponse<Response>()
    const startedAt = Date.now()
    const { method, originalUrl } = request

    return next.handle().pipe(
      tap({
        next: () => this.write(method, originalUrl, response.statusCode, startedAt, request),
        error: (error: { status?: number }) =>
          this.write(method, originalUrl, error?.status ?? 500, startedAt, request),
      }),
    )
  }

  private write(
    method: string,
    url: string,
    statusCode: number,
    startedAt: number,
    request: Request & { requestId?: string },
  ): void {
    const duration = Date.now() - startedAt
    const line = `${method} ${url} ${statusCode} ${duration}ms ip=${request.ip} ua="${
      request.headers['user-agent'] ?? ''
    }" requestId=${request.requestId ?? '-'}`
    if (duration > 1000) {
      this.logger.warn(`SLOW ${line}`)
    } else {
      this.logger.log(line)
    }
  }
}
