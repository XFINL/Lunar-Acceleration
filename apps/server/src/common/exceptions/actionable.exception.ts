import { BadRequestException } from '@nestjs/common'

/** 仅用于开发者编写、已脱敏且可向用户展示的说明；禁止传入第三方原始异常。 */
export class ActionableBadRequestException extends BadRequestException {
  constructor(readonly safeMessage: string) {
    super(safeMessage)
  }
}
