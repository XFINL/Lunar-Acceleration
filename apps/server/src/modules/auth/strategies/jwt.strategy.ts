import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ErrorCode } from '@lunar/shared'
import type { JwtConfig } from '../../../config/configuration'
import { BusinessException } from '../../../common/exceptions/business.exception'
import type { AuthUser, JwtPayload } from '../../../common/interfaces/auth-user.interface'
import { AuthService } from '../auth.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const jwt = configService.get<JwtConfig>('jwt')!
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwt.secret,
    })
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (!payload?.sub) {
      throw new BusinessException(ErrorCode.TOKEN_INVALID)
    }
    return this.authService.buildAuthUser(payload.sub)
  }
}
