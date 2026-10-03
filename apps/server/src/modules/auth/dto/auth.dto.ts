import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator'

export class LoginDto {
  @ApiProperty({ description: '用户名', example: 'admin' })
  @IsString()
  @Length(3, 64)
  username!: string

  @ApiProperty({ description: '密码', example: 'Admin@123456' })
  @IsString()
  @Length(6, 64)
  password!: string

  @ApiPropertyOptional({ description: '验证码' })
  @IsString()
  @IsOptional()
  captcha?: string

  @ApiPropertyOptional({ description: '验证码 ID' })
  @IsString()
  @IsOptional()
  captchaId?: string

  @ApiPropertyOptional({ description: '记住我' })
  @IsBoolean()
  @IsOptional()
  remember?: boolean
}

export class RegisterDto {
  @ApiProperty({ description: '用户名' })
  @IsString()
  @Length(3, 64)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: '用户名只能包含字母、数字、下划线和短横线' })
  username!: string

  @ApiPropertyOptional({ description: '邮箱' })
  @IsEmail()
  @IsOptional()
  email?: string

  @ApiProperty({ description: '密码：8-32 位，含大小写字母与数字' })
  @IsString()
  @Length(8, 32)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[\S]{8,32}$/, {
    message: '密码需 8-32 位且包含大小写字母与数字',
  })
  password!: string

  @ApiPropertyOptional({ description: '邀请码' })
  @IsString()
  @IsOptional()
  inviteCode?: string

  @ApiPropertyOptional({ description: '验证码' })
  @IsString()
  @IsOptional()
  captcha?: string

  @ApiPropertyOptional({ description: '验证码 ID' })
  @IsString()
  @IsOptional()
  captchaId?: string
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh Token' })
  @IsString()
  refreshToken!: string
}
