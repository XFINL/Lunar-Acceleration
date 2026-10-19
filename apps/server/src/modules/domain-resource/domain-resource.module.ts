import { Module } from '@nestjs/common'
import { DomainResourceController } from './domain-resource.controller'
import { DomainResourceService } from './domain-resource.service'

@Module({
  controllers: [DomainResourceController],
  providers: [DomainResourceService],
  exports: [DomainResourceService],
})
export class DomainResourceModule {}
