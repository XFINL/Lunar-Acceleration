import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export const MAX_PAGE_SIZE = 100

export class PaginationQueryDto {
  @ApiPropertyOptional({ description: '页码，从 1 开始', default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1

  @ApiPropertyOptional({ description: '每页条数', default: 20, maximum: MAX_PAGE_SIZE })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @IsOptional()
  pageSize = 20

  @ApiPropertyOptional({ description: '排序字段', default: 'createdAt' })
  @IsString()
  @IsOptional()
  sort = 'createdAt'

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], default: 'desc' })
  @IsIn(['asc', 'desc'])
  @IsOptional()
  order: 'asc' | 'desc' = 'desc'

  @ApiPropertyOptional({ description: '关键词搜索' })
  @IsString()
  @IsOptional()
  keyword?: string

  @ApiPropertyOptional({ description: '状态筛选' })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  status?: number

  get skip(): number {
    return (this.page - 1) * this.pageSize
  }

  get take(): number {
    return this.pageSize
  }
}
