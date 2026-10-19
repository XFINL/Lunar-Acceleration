import { Injectable } from '@nestjs/common'
import { AliDriver } from './ali.driver'
import { CloudflareDriver } from './cloudflare.driver'
import { VendorCode, VendorCredentials, VendorDriver } from './vendor-driver'

@Injectable()
export class DriverFactory {
  create(code: VendorCode, credentials: VendorCredentials): VendorDriver {
    switch (code) {
      case 'cloudflare': return new CloudflareDriver(credentials)
      case 'ali': return new AliDriver(credentials)
      default: throw new Error('Unsupported built-in vendor driver')
    }
  }
}
