import { Module } from '@nestjs/common'
import { AdminUserController } from './admin-user.controller'
import { UserController } from './user.controller'
import { UserService } from './user.service'

@Module({
  controllers: [UserController, AdminUserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
