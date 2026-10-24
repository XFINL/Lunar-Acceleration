import { Module } from '@nestjs/common'
import { StatisticsService } from './statistics.service'
import { M5Service } from './m5.service'
import { M5Controller, NodeReportController } from './m5.controller'
import { M5RealtimeGateway } from './m5-realtime.gateway'

@Module({ controllers: [M5Controller, NodeReportController], providers: [StatisticsService, M5Service, M5RealtimeGateway] })
export class StatisticsModule {}
