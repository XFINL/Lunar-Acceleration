import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { ErrorCode } from '@lunar/shared'
import type { Request } from 'express'
import { map, Observable } from 'rxjs'

export interface TransformedResponse<T> {
  code: number
  message: string
  data: T
  requestId: string | undefined
}

/**
 * 统一响应包装（见 03-api.md §1.3）
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, TransformedResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<TransformedResponse<T>> {
    const request = context.switchToHttp().getRequest<Request & { requestId?: string }>()
    return next.handle().pipe(
      map((data) => ({
        code: ErrorCode.SUCCESS,
        message: 'success',
        data,
        requestId: request.requestId,
      })),
    )
  }
}
