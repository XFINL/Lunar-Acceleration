import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { RequirePermissions } from '../../common/decorators/permissions.decorator'
import { PermissionsGuard } from '../../common/guards/permissions.guard'
import type { AuthUser } from '../../common/interfaces/auth-user.interface'
import { DomainService, parseBigIntId, normalizeDomain } from './domain.service'
import { Prisma } from '@prisma/client'
import { isIP } from 'node:net'
import { BusinessException } from '../../common/exceptions/business.exception'
import { ErrorCode } from '@lunar/shared'
import { PrismaService } from '../../database/prisma.service'
class DomainConfigDto {
 @IsOptional() @Type(()=>Number) @IsInt() @Min(0) @Max(31536000) defaultTtl?:number
 @IsOptional() @IsString() @IsIn(['http','https','follow']) originProtocol?:string
 @IsOptional() @IsString() originHost?:string
}
function normalizeOriginHost(value?: string): string | undefined {
 if (value === undefined) return undefined
 if (!value || value.length > 253 || /[\s\x00-\x1f\x7f/:?#@]/.test(value)) throw new BusinessException(ErrorCode.PARAM_INVALID, 'originHost 格式错误')
 if (isIP(value)) return value
 return normalizeDomain(value)
}

@ApiTags('用户端 - 域名配置') @ApiBearerAuth() @UseGuards(PermissionsGuard) @Controller('user/domains/:id/config')
export class DomainConfigController {
 constructor(private readonly domains:DomainService,private readonly prisma:PrismaService){}
 @Get() @RequirePermissions('domain:read') async get(@CurrentUser() user:AuthUser,@Param('id') id:string){await this.domains.requireOwned(user.id,id);const c=await this.prisma.domainConfig.findUnique({where:{domainId:parseBigIntId(id)}});return c?{...c,domainId:c.domainId.toString(),certId:c.certId?.toString()??null}:null}
 @Put() @RequirePermissions('domain:update') async update(@CurrentUser() user:AuthUser,@Param('id') id:string,@Body() dto:DomainConfigDto){const domainId=parseBigIntId(id);const originHost=normalizeOriginHost(dto.originHost);const c=await this.prisma.$transaction(async tx=>{await tx.$queryRaw(Prisma.sql`SELECT id FROM domains WHERE id = ${domainId} AND user_id = ${parseBigIntId(user.id)} AND deleted_at IS NULL FOR UPDATE`);await this.domains.requireOwned(user.id,id,tx);return tx.domainConfig.upsert({where:{domainId},create:{domainId,...dto,originHost},update:{...dto,originHost}})});return {...c,domainId:c.domainId.toString(),certId:c.certId?.toString()??null}}
}
