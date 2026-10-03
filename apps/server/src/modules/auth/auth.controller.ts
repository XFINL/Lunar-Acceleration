import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import type { AuthUser } from '../../common/interfaces/auth-user.interface'
import { getClientIp, getUserAgent } from '../../common/utils/ip.util'
import { AuthService } from './auth.service'
import { LoginDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto'

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('captcha')
  @ApiOperation({ summary: '获取图形验证码' })
  async captcha() {
    return this.authService.createCaptcha()
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: '登录' })
  async login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.authService.login(dto, getClientIp(request), getUserAgent(request))
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @ApiOperation({ summary: '注册' })
  async register(@Body() dto: RegisterDto, @Req() request: Request) {
    return this.authService.register(dto, getClientIp(request), getUserAgent(request))
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '刷新 Token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken)
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '登出' })
  async logout(
    @CurrentUser() user: AuthUser,
    @Body() body: { refreshToken?: string },
  ) {
    await this.authService.logout(user.id, body?.refreshToken)
    return { success: true }
  }
}
