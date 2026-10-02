import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { ErrorCode, type FieldError } from '@lunar/shared'
import type { Request, Response } from 'express'
import { BusinessException } from '../exceptions/business.exception'
import { I18nService } from '../../shared/i18n/i18n.service'

interface ErrorBody {
  code: number
  message: string
  errors?: FieldError[]
  requestId?: string
}

/**
 * 全局异常过滤器：统一错误格式 + 错误码 + 多语言（见 03-api.md §1.3 / 05-backend.md §11）
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception')

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const request = ctx.getRequest<Request & { requestId?: string }>()
    const response = ctx.getResponse<Response>()
    const locale = this.i18n.resolveLocale(request.headers['accept-language'])

    const { status, body } = this.resolve(exception, locale)
    body.requestId = request.requestId

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${body.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      )
    }

    response.status(status).json(body)
  }

  private resolve(exception: unknown, locale: ReturnType<I18nService['resolveLocale']>) {
    // 业务异常
    if (exception instanceof BusinessException) {
      return {
        status: HttpStatus.OK,
        body: {
          code: exception.code,
          message: this.i18n.translateError(exception.code, locale),
        } as ErrorBody,
      }
    }

    // 参数校验（ValidationPipe）
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const payload = exception.getResponse()
      if (typeof payload === 'object' && payload !== null && 'message' in payload) {
        const rawMessage = (payload as { message: unknown }).message
        const fieldErrors = this.toFieldErrors(rawMessage)
        if (fieldErrors.length > 0) {
          return {
            status,
            body: {
              code: ErrorCode.PARAM_INVALID,
              message: this.i18n.translateError(ErrorCode.PARAM_INVALID, locale),
              errors: fieldErrors,
            } as ErrorBody,
          }
        }
      }
      const code = this.mapStatusToCode(status)
      return {
        status,
        body: {
          code,
          message: this.i18n.translateError(code, locale),
        } as ErrorBody,
      }
    }

    // Prisma 异常
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrisma(exception, locale)
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ErrorCode.INTERNAL_ERROR,
        message: this.i18n.translateError(ErrorCode.INTERNAL_ERROR, locale),
      } as ErrorBody,
    }
  }

  private resolvePrisma(
    exception: Prisma.PrismaClientKnownRequestError,
    locale: ReturnType<I18nService['resolveLocale']>,
  ) {
    const map: Record<string, { status: number; code: ErrorCode }> = {
      P2002: { status: HttpStatus.CONFLICT, code: ErrorCode.USERNAME_EXISTS },
      P2025: { status: HttpStatus.NOT_FOUND, code: ErrorCode.RECORD_NOT_FOUND },
      P2003: { status: HttpStatus.BAD_REQUEST, code: ErrorCode.PARAM_INVALID },
    }
    const mapped = map[exception.code] ?? {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
    }
    return {
      status: mapped.status,
      body: {
        code: mapped.code,
        message: this.i18n.translateError(mapped.code, locale),
      } as ErrorBody,
    }
  }

  private toFieldErrors(raw: unknown): FieldError[] {
    if (!Array.isArray(raw)) return []
    return raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => {
        const [field, ...rest] = item.split(' ')
        return { field: field ?? 'unknown', message: rest.join(' ') || item }
      })
  }

  private mapStatusToCode(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.PARAM_INVALID
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN
      case HttpStatus.NOT_FOUND:
        return ErrorCode.RECORD_NOT_FOUND
      case HttpStatus.CONFLICT:
        return ErrorCode.RECORD_NOT_FOUND
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.TOO_MANY_REQUESTS
      default:
        return ErrorCode.INTERNAL_ERROR
    }
  }
}
