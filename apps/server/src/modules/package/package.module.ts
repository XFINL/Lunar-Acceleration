import { Module } from '@nestjs/common'
import { AdminPackageController, AdminUserPackageController } from './admin-package.controller'
import { PackageController } from './package.controller'
import { PackageService } from './package.service'

@Module({
  controllers: [PackageController, AdminPackageController, AdminUserPackageController],
  providers: [PackageService],
  exports: [PackageService],
})
export class PackageModule {}
