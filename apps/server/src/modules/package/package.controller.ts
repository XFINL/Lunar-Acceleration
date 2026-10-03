import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { PaginationQueryDto } from '../../common/dto/pagination.dto'
import { paginate } from '../../common/dto/response.dto'
import type { AuthUser } from '../../common/interfaces/auth-user.interface'
import { PackageService } from './package.service'

@ApiTags('用户端 - 套餐')
@ApiBearerAuth()
@Controller('user')
export class PackageController {
  constructor(private readonly packageService: PackageService) {}

  @Get('packages')
  @ApiOperation({ summary: '套餐列表（仅上架）' })
  async list(@Query() query: PaginationQueryDto) {
    const { total, list } = await this.packageService.listOnline({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
    })
    return paginate(list, query.page, query.pageSize, total)
  }

  @Get('packages/:id')
  @ApiOperation({ summary: '套餐详情' })
  async detail(@Param('id') id: string) {
    return this.packageService.getOnlineDetail(id)
  }

  @Get('my-package')
  @ApiOperation({ summary: '我的当前套餐' })
  async myPackage(@CurrentUser() user: AuthUser) {
    return this.packageService.getMyPackage(user.id)
  }
}
