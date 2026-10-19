import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { paginate } from '../../common/dto/response.dto'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import type { AuthUser } from '../../common/interfaces/auth-user.interface'
import { CertificateService } from './certificate.service'
import { AcmeService } from './acme.service'

class ApplyAcmeDto {
  @ApiPropertyOptional({ type: [String], description: '1–10 owned, approved domain IDs. Use domainId for one domain.' })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsString({ each: true }) @Matches(/^[1-9]\d{0,19}$/, { each: true }) domainIds?: string[]

  @ApiPropertyOptional({ description: 'Owned, approved domain ID for a single-name certificate.' })
  @IsOptional() @IsString() @Matches(/^[1-9]\d{0,19}$/) domainId?: string

  @ApiPropertyOptional({ description: 'Unattended renewal requires explicit Cloudflare DNS configuration.' })
  @IsOptional() @Transform(({ obj, key }) => obj[key]) @IsBoolean() autoRenew?: boolean
}

class UploadCertificateDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @Length(1, 128)
  name!: string

  @ApiProperty({ description: 'PEM leaf followed by its intermediate certificate chain; signatures are checked and the chain is preserved.' })
  @IsString()
  certPem!: string

  @ApiProperty({ description: 'PEM-encoded private key; it is encrypted before persistence and never returned.' })
  @IsString()
  keyPem!: string
}

class BindCertificateDto {
  @ApiProperty({ type: String, nullable: true, description: 'Certificate ID, or null to unbind.' })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  certId!: string | null
}

class UpdateHttpsDto {
  @ApiPropertyOptional() @IsOptional() @Transform(({ obj, key }) => obj[key]) @IsBoolean() httpsEnabled?: boolean
  @ApiPropertyOptional() @IsOptional() @Transform(({ obj, key }) => obj[key]) @IsBoolean() forceHttps?: boolean
  @ApiPropertyOptional() @IsOptional() @Transform(({ obj, key }) => obj[key]) @IsBoolean() hstsEnabled?: boolean
  @ApiPropertyOptional({ minimum: 0, maximum: 31536000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(31536000) hstsMaxAge?: number
  @ApiPropertyOptional({ enum: ['TLSv1.2', 'TLSv1.3'] }) @IsOptional() @IsIn(['TLSv1.2', 'TLSv1.3']) tlsVersion?: string
}

@ApiTags('用户端 - 证书与 HTTPS')
@ApiBearerAuth()
@Controller('user')
@UseGuards(PermissionsGuard)
export class CertificateController {
  constructor(private readonly service: CertificateService, private readonly acme: AcmeService) {}

  @Get('certificates')
  @RequirePermissions('cert:read')
  @ApiOperation({ summary: '证书列表（仅元数据）' })
  async list(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    const result = await this.service.list(user.id, query.page, query.pageSize)
    return paginate(result.list, query.page, query.pageSize, result.pagination.total)
  }

  @Post('certificates')
  @RequirePermissions('cert:create')
  @ApiOperation({ summary: '上传并验证手动证书' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: UploadCertificateDto) {
    return this.service.create(user.id, dto)
  }

  @Post('certificates/apply')
  @RequirePermissions('cert:create')
  @ApiOperation({ summary: '申请 ACME DNS-01 证书，返回 TXT 挑战信息' })
  applyAcme(@CurrentUser() user: AuthUser, @Body() dto: ApplyAcmeDto) {
    return this.acme.apply(user.id, dto)
  }

  @Post('certificates/apply-acme')
  @RequirePermissions('cert:create')
  @ApiOperation({ summary: '兼容别名：申请 ACME DNS-01 证书' })
  applyAcmeAlias(@CurrentUser() user: AuthUser, @Body() dto: ApplyAcmeDto) {
    return this.acme.apply(user.id, dto)
  }

  @Post('certificates/:id/renew')
  @RequirePermissions('cert:update')
  @ApiOperation({ summary: '续期证书（复用原 ID 与域名绑定）' })
  renew(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.acme.renew(user.id, id)
  }

  @Get('certificate-jobs')
  @RequirePermissions('cert:read')
  @ApiOperation({ summary: '分页读取当前用户近期 ACME job 与公开 DNS 挑战信息' })
  listCertificateJobs(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.acme.listJobs(user.id, query.page, query.pageSize)
  }

  @Get('certificate-jobs/:id')
  @RequirePermissions('cert:read')
  @ApiOperation({ summary: '读取 ACME job 状态与公开 DNS 挑战信息' })
  getCertificateJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.acme.getJob(user.id, id)
  }

  @Post('certificate-jobs/:id/complete')
  @RequirePermissions('cert:update')
  @ApiOperation({ summary: '验证已发布 TXT 并继续 DNS-01 签发' })
  completeCertificateJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.acme.complete(user.id, id)
  }

  @Get('certificates/:id')
  @RequirePermissions('cert:read')
  @ApiOperation({ summary: '证书元数据' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.id, id)
  }

  @Delete('certificates/:id')
  @RequirePermissions('cert:delete')
  @ApiOperation({ summary: '删除未绑定证书' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.id, id)
  }

  @Put('domains/:id/cert')
  @RequirePermissions('cert:update')
  @ApiOperation({ summary: '绑定或解绑域名证书' })
  bind(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: BindCertificateDto) {
    if (dto.certId !== null && (typeof dto.certId !== 'string' || !/^[1-9]\d{0,19}$/.test(dto.certId))) {
      throw new BadRequestException('Invalid certificate ID')
    }
    return this.service.bindDomainCertificate(user.id, id, dto.certId)
  }

  @Post('domains/:id/cert')
  @RequirePermissions('cert:update')
  @ApiOperation({ summary: '绑定或解绑域名证书（文档兼容）' })
  bindPost(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: BindCertificateDto) {
    return this.bind(user, id, dto)
  }

  @Get('domains/:id/https')
  @RequirePermissions('domain:read')
  @ApiOperation({ summary: '读取 HTTPS 控制面配置' })
  getHttps(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getHttps(user.id, id)
  }

  @Put('domains/:id/https')
  @RequirePermissions('domain:update')
  @ApiOperation({ summary: '更新 HTTPS 控制面配置；保存不代表 TLS 已部署' })
  updateHttps(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateHttpsDto) {
    return this.service.updateHttps(user.id, id, dto)
  }
}
