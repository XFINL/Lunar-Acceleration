import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsIP,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'

const UINT64_TEXT = /^(0|[1-9][0-9]{0,19})$/
const UINT32_MAX = 4294967295

export class NodeListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  region?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(UINT64_TEXT)
  nodeGroupId?: string
}

export class NodeMetricQueryDto extends PaginationQueryDto {}

export class CreateNodeDto {
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  name!: string

  @ApiProperty()
  @IsIP()
  ip!: string

  @ApiPropertyOptional({ default: 443 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number

  @ApiPropertyOptional()
  @IsString()
  @Length(1, 64)
  @IsOptional()
  region?: string

  @ApiPropertyOptional()
  @IsString()
  @Length(1, 64)
  @IsOptional()
  isp?: string

  @ApiPropertyOptional({ description: '十进制 uint64 字符串' })
  @IsOptional()
  @IsString()
  @Matches(UINT64_TEXT)
  nodeGroupId?: string | null

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(UINT32_MAX)
  weight?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(UINT32_MAX)
  bandwidthMbps?: number
}

export class UpdateNodeDto {
  @ApiPropertyOptional()
  @IsString()
  @Length(1, 64)
  @IsOptional()
  name?: string

  @ApiPropertyOptional()
  @IsIP()
  @IsOptional()
  ip?: string

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  port?: number

  @ApiPropertyOptional()
  @IsString()
  @Length(1, 64)
  @IsOptional()
  region?: string | null

  @ApiPropertyOptional()
  @IsString()
  @Length(1, 64)
  @IsOptional()
  isp?: string | null

  @ApiPropertyOptional({ description: '十进制 uint64 字符串或 null' })
  @IsOptional()
  @IsString()
  @Matches(UINT64_TEXT)
  nodeGroupId?: string | null

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UINT32_MAX)
  @IsOptional()
  weight?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UINT32_MAX)
  @IsOptional()
  bandwidthMbps?: number | null

  @ApiPropertyOptional({ description: '1在线 2离线 3维护 4部署中' })
  @Type(() => Number)
  @IsIn([1, 2, 3, 4])
  @IsOptional()
  status?: number
}

export class CreateNodeGroupDto {
  @ApiProperty()
  @IsString()
  @Length(1, 64)
  name!: string

  @ApiPropertyOptional()
  @IsString()
  @Length(1, 255)
  @IsOptional()
  description?: string

  @ApiPropertyOptional()
  @IsString()
  @Length(1, 64)
  @IsOptional()
  region?: string
}

export class UpdateNodeGroupDto {
  @ApiPropertyOptional()
  @IsString()
  @Length(1, 64)
  @IsOptional()
  name?: string

  @ApiPropertyOptional()
  @IsString()
  @Length(1, 255)
  @IsOptional()
  description?: string | null

  @ApiPropertyOptional()
  @IsString()
  @Length(1, 64)
  @IsOptional()
  region?: string | null
}

export class HeartbeatLoadDto {
  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  cpu?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  mem?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  disk?: number
}

export class HeartbeatDto {
  @ApiProperty({ example: '1.21.4.1' })
  @IsString()
  @Length(1, 32)
  version!: string

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(UINT32_MAX)
  @IsOptional()
  uptime?: number

  @ApiPropertyOptional({ type: HeartbeatLoadDto })
  @ValidateNested()
  @Type(() => HeartbeatLoadDto)
  @IsOptional()
  load?: HeartbeatLoadDto

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(UINT32_MAX)
  @IsOptional()
  connections?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(UINT32_MAX)
  @IsOptional()
  qps?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UINT32_MAX)
  @IsOptional()
  cpuCores?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UINT32_MAX)
  @IsOptional()
  memoryMb?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UINT32_MAX)
  @IsOptional()
  diskGb?: number
}

export class NodeMetricPointDto {
  @ApiProperty()
  @IsISO8601({ strict: true })
  time!: string

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  cpu?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  mem?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  disk?: number

  @ApiPropertyOptional({ description: 'uint64 十进制字符串，保持精度' })
  @IsString()
  @Matches(UINT64_TEXT)
  @IsOptional()
  bandwidthIn?: string

  @ApiPropertyOptional({ description: 'uint64 十进制字符串，保持精度' })
  @IsString()
  @Matches(UINT64_TEXT)
  @IsOptional()
  bandwidthOut?: string

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(UINT32_MAX)
  @IsOptional()
  connections?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(UINT32_MAX)
  @IsOptional()
  qps?: number

  @ApiPropertyOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  cacheHitRate?: number
}

export class ReportNodeMetricsDto {
  @ApiProperty({ type: [NodeMetricPointDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => NodeMetricPointDto)
  metrics!: NodeMetricPointDto[]
}
