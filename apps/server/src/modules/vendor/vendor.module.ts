import { Module } from '@nestjs/common'
import { VendorController } from './vendor.controller'
import { VendorService } from './vendor.service'
import { DriverFactory } from './drivers/driver.factory'
import { VendorWriteService } from './vendor-write.service'
import { VendorWriteWorker } from './vendor-write.worker'
import { VendorWriteController } from './vendor-write.controller'

@Module({ controllers: [VendorController, VendorWriteController], providers: [VendorService, DriverFactory, VendorWriteService, VendorWriteWorker], exports: [VendorService, VendorWriteService, DriverFactory] })
export class VendorModule {}
