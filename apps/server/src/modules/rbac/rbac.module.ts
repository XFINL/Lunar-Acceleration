import { Global, Module } from '@nestjs/common'
import { RbacService } from './rbac.service'
import { RoleController } from './role.controller'

@Global()
@Module({
  controllers: [RoleController],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
