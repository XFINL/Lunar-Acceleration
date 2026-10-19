import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { PaginationQueryDto } from '../../../common/dto/pagination.dto'
export class CreateDomainDto {
  @ApiProperty() @IsString() @Length(1, 1024) domain!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @IsIn(['网站', '下载', '视频', '直播', 'static', 'download', 'video', 'live']) businessType?: string
  @ApiPropertyOptional() @IsOptional() @IsArray() tags?: unknown[]
  @ApiPropertyOptional({ description: '可选；与域名同一事务创建的源站组及源站' }) @IsOptional() @IsObject() originGroup?: Record<string, unknown>
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) remark?: string
}
export class UpdateDomainDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) remark?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @IsIn(['网站', '下载', '视频', '直播', 'static', 'download', 'video', 'live']) businessType?: string
  @ApiPropertyOptional() @IsOptional() @IsArray() tags?: unknown[]
}
export class AuditDomainDto {
  @ApiProperty() @IsBoolean() approve!: boolean
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) remark?: string
}
export class DomainListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: [1, 2, 3, 4, 5, 6] }) @IsOptional() @Type(() => Number) @IsInt() @IsIn([1, 2, 3, 4, 5, 6]) status?: number = undefined
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) auditStatus?: number
}

export class BatchDomainDto {
  @ApiProperty({ enum: ['delete', 'disable', 'check'] }) @IsString() @IsIn(['delete', 'disable', 'check'])
  action!: 'delete' | 'disable' | 'check'

  @ApiProperty({ type: [String], minItems: 1, maxItems: 100 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique()
  @IsString({ each: true }) @Matches(/^[1-9][0-9]{0,19}$/, { each: true })
  ids!: string[]
}
