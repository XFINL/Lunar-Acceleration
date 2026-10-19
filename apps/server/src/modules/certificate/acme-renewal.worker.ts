import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue, Worker } from 'bullmq'
import type { RedisConfig } from '../../config/configuration'
import { AcmeService } from './acme.service'

const QUEUE_NAME = 'lunar-certificate-renewals'

/** Redis-backed recurring work is opt-in so ordinary test/dev application processes never connect to Redis. */
@Injectable()
export class AcmeRenewalWorker implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue
  private worker?: Worker
  private readonly logger = new Logger(AcmeRenewalWorker.name)

  constructor(private readonly config: ConfigService, private readonly acme: AcmeService) {}

  async onModuleInit() {
    if (process.env.ACME_WORKER_ENABLED !== 'true') return
    const redis = this.config.get<RedisConfig>('redis')!
    const connection = { host: redis.host, port: redis.port, password: redis.password, db: redis.db, maxRetriesPerRequest: null as null }
    this.queue = new Queue(QUEUE_NAME, { connection })
    this.worker = new Worker(QUEUE_NAME, async (job) => {
      if (job.name === 'scan-expiring-certificates') return this.acme.prepareAutoRenewals()
    }, { connection, concurrency: 1 })
    this.worker.on('error', () => this.logger.error('ACME worker error; check Redis and worker health. Raw error details are omitted.'))
    this.worker.on('failed', () => this.logger.error('ACME renewal scan failed; the queue will retry according to its bounded retry policy.'))
    this.queue.on('error', () => this.logger.error('ACME queue error; check Redis availability. Raw error details are omitted.'))
    await this.queue.upsertJobScheduler('daily-auto-renewals', { pattern: '0 3 * * *', tz: 'UTC' }, {
      name: 'scan-expiring-certificates', data: {},
      opts: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 100, removeOnFail: 100 },
    })
  }

  async onModuleDestroy() {
    await this.worker?.close()
    await this.queue?.close()
  }
}
