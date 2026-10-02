import { HttpException, HttpStatus } from '@nestjs/common'
import { ErrorCode, ERROR_MESSAGE_MAP } from '@lunar/shared'

/**
 * 业务异常：携带统一错误码，消息由异常过滤器按语言翻译
 */
export class BusinessException extends HttpException {
  readonly code: number

  constructor(code: ErrorCode, message?: string, httpStatus: HttpStatus = HttpStatus.OK) {
    super(message ?? ERROR_MESSAGE_MAP[code] ?? 'Error', httpStatus)
    this.code = code
  }
}
