import { Module } from '@nestjs/common'
import { DomainController } from './domain.controller'
import { DomainAuditController } from './domain-audit.controller'
import { DomainService } from './domain.service'
@Module({ controllers:[DomainController,DomainAuditController], providers:[DomainService], exports:[DomainService] })
export class DomainModule {}
