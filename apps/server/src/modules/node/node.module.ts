import { Module } from '@nestjs/common'
import { NodeService } from './node.service'
import { NodeHmacGuard } from './node-hmac.guard'
import { AdminNodeController, AdminNodeGroupController, NodeCommunicationController } from './node.controller'

@Module({
  controllers: [AdminNodeController, AdminNodeGroupController, NodeCommunicationController],
  providers: [NodeService, NodeHmacGuard],
})
export class NodeModule {}
