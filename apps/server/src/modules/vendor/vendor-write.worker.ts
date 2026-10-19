import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { VendorWriteService } from './vendor-write.service'

@Injectable()
export class VendorWriteWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>
  constructor(private readonly writes: VendorWriteService) {}

  onModuleInit() {
    if (process.env.VENDOR_WRITE_WORKER_ENABLED !== 'true') return
    this.timer = setInterval(() => { void this.writes.tick() }, 1000)
    this.timer.unref?.()
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer) }
}
