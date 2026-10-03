import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import type { RedisConfig } from '../../config/configuration'

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis

  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {
    const redis = this.configService.get<RedisConfig>('redis')!
    this.client = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password,
      db: redis.db,
      lazyConnect: false,
      maxRetriesPerRequest: null,
    })
  }

  getClient(): Redis {
    return this.client
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, 'EX', ttlSeconds)
    } else {
      await this.client.set(key, value)
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.client.del(...keys)
    }
  }

  /** 删除匹配前缀的键（使用 SCAN，避免阻塞） */
  async delByPrefix(prefix: string): Promise<void> {
    let cursor = '0'
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200)
      cursor = next
      if (keys.length > 0) {
        await this.client.del(...keys)
      }
    } while (cursor !== '0')
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key)
    if (count === 1) {
      await this.client.expire(key, ttlSeconds)
    }
    return count
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds)
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit()
  }
}
