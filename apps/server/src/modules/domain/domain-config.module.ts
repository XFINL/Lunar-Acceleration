import { Module } from '@nestjs/common'
import { DomainConfigController } from './domain-config.controller'
import { DomainModule } from './domain.module'
@Module({ imports:[DomainModule],controllers:[DomainConfigController] })
export class DomainConfigModule {}
