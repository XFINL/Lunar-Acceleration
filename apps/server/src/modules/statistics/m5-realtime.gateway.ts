import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { IncomingMessage, Server as HttpServer } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { Prisma } from '@prisma/client'
import { WebSocket, WebSocketServer } from 'ws'
import { PrismaService } from '../../database/prisma.service'

type Filters = { statusCode?: number[]; ip?: string; url?: string }
type Subscription = { domainId: string; filters: Filters }
type Client = { userId: string; subscriptions: Map<string, Subscription>; windowAt: number; messages: number; tokenExpiresAt: number; expiryTimer?: NodeJS.Timeout }
type VerifiedToken = { sub: string; exp: number; nbf?: number }
const MAX_CONNECTIONS = 2000
const MAX_CONNECTIONS_PER_USER = 5
const MAX_SUBSCRIPTIONS_PER_CONNECTION = 10
const MAX_SUBSCRIPTIONS_PER_USER = 20
const MAX_MESSAGES_PER_MINUTE = 30
const MAX_MESSAGE_BYTES = 4096
const U64 = 18446744073709551615n

@Injectable()
export class M5RealtimeGateway implements OnModuleDestroy {
  private wss?: WebSocketServer
  private server?: HttpServer
  private readonly clients = new Map<WebSocket, Client>()
  private upgradeHandler?: (request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => void
  private readonly jwtSecret: string

  constructor(private readonly db: PrismaService, config: ConfigService) {
    this.jwtSecret = config.get<string>('jwt.secret') ?? ''
  }

  attach(server: HttpServer): void {
    if (this.server === server) return
    if (this.server && this.upgradeHandler) this.server.off('upgrade', this.upgradeHandler)
    this.wss?.close()
    this.server = server
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false })
    this.upgradeHandler = (request, socket, head) => {
      let url: URL
      try { url = new URL(request.url ?? '/', 'http://localhost') } catch { return }
      if (url.pathname !== '/api/v1/user/logs/realtime') return
      void this.accept(request, socket, head, url)
    }
    server.on('upgrade', this.upgradeHandler)
  }

  private async accept(request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer, url: URL): Promise<void> {
    const token = url.searchParams.get('token')
    if (!token || token.length > 4096 || !this.jwtSecret) return this.reject(socket, 401, 'Unauthorized')
    let payload: VerifiedToken
    try { payload = this.verifyToken(token) } catch { return this.reject(socket, 401, 'Unauthorized') }
    if (this.clients.size >= MAX_CONNECTIONS) return this.reject(socket, 503, 'Unavailable')
    try {
      const user = await this.db.$queryRaw<{ id: string; status: number; deleted_at: Date | null }[]>(Prisma.sql`SELECT CAST(id AS CHAR) AS id,status,deleted_at FROM users WHERE id=CAST(${payload.sub} AS UNSIGNED) LIMIT 1`)
      if (!user.length || Number(user[0].status) !== 1 || user[0].deleted_at) return this.reject(socket, 401, 'Unauthorized')
      const permissions = await this.db.$queryRaw<{ code: string }[]>(Prisma.sql`SELECT DISTINCT p.code FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=CAST(${payload.sub} AS UNSIGNED)`)
      if (!permissions.some(row => row.code === 'log:read')) return this.reject(socket, 403, 'Forbidden')
      const entitlement = await this.db.$queryRaw<{ enabled: number | boolean }[]>(Prisma.sql`SELECT 1 AS enabled FROM user_packages up JOIN packages p ON p.id=up.package_id WHERE up.user_id=CAST(${payload.sub} AS UNSIGNED) AND up.status=1 AND up.start_at<=UTC_TIMESTAMP() AND up.expire_at>UTC_TIMESTAMP() AND p.status=1 AND JSON_UNQUOTE(JSON_EXTRACT(p.feature_flags,'$.realtime_log')) IN ('true','1') LIMIT 1`)
      if (!entitlement.length) return this.reject(socket, 403, 'Forbidden')
      if (this.countUserConnections(payload.sub) >= MAX_CONNECTIONS_PER_USER) return this.reject(socket, 429, 'Too Many Requests')
      // Re-check after asynchronous authorization to close races from concurrent upgrades.
      if (this.clients.size >= MAX_CONNECTIONS || this.countUserConnections(payload.sub) >= MAX_CONNECTIONS_PER_USER) return this.reject(socket, 429, 'Too Many Requests')
      this.wss!.handleUpgrade(request, socket, head, ws => {
        const client: Client = { userId: payload.sub, subscriptions: new Map(), windowAt: Date.now(), messages: 0, tokenExpiresAt: payload.exp * 1000 }
        this.clients.set(ws, client)
        this.scheduleExpiry(ws, client)
        ws.on('message', data => { void this.handleMessage(ws, client, data) })
        ws.on('close', () => { clearTimeout(client.expiryTimer); this.clients.delete(ws) })
        ws.on('error', () => { clearTimeout(client.expiryTimer); this.clients.delete(ws) })
      })
    } catch {
      this.reject(socket, 503, 'Unavailable')
    }
  }

  private verifyToken(token: string): VerifiedToken {
    const parts = token.split('.')
    if (parts.length !== 3) throw new Error('invalid token')
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: string; typ?: string }
    if (header.alg !== 'HS256' || (header.typ !== undefined && header.typ !== 'JWT')) throw new Error('invalid token')
    const expected = createHmac('sha256', this.jwtSecret).update(`${parts[0]}.${parts[1]}`).digest()
    const supplied = Buffer.from(parts[2], 'base64url')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('invalid token')
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Partial<VerifiedToken>
    if (typeof payload.sub !== 'string' || !/^[1-9]\d{0,19}$/.test(payload.sub) || BigInt(payload.sub) > U64 || typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000) || (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isSafeInteger(payload.nbf) || payload.nbf > Math.floor(Date.now() / 1000)))) throw new Error('invalid token')
    return payload as VerifiedToken
  }

  private scheduleExpiry(ws: WebSocket, client: Client): void {
    const remaining = client.tokenExpiresAt - Date.now()
    if (remaining <= 0) { ws.close(1008, 'token expired'); return }
    client.expiryTimer = setTimeout(() => this.scheduleExpiry(ws, client), Math.min(remaining, 2147483647))
  }

  private reject(socket: import('node:stream').Duplex, status: number, reason: string): void {
    if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  }

  private countUserConnections(userId: string): number {
    let count = 0
    for (const client of this.clients.values()) if (client.userId === userId) count++
    return count
  }

  private async handleMessage(ws: WebSocket, client: Client, raw: Buffer | ArrayBuffer | Buffer[]): Promise<void> {
    const bytes = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer)
    const now = Date.now()
    if (bytes.length > MAX_MESSAGE_BYTES) return this.closeWithError(ws, 'message_too_large')
    if (now - client.windowAt >= 60000) { client.windowAt = now; client.messages = 0 }
    if (++client.messages > MAX_MESSAGES_PER_MINUTE) return this.closeWithError(ws, 'rate_limited')
    let message: unknown
    try { message = JSON.parse(bytes.toString('utf8')) } catch { return this.closeWithError(ws, 'invalid_message') }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return this.closeWithError(ws, 'invalid_message')
    const input = message as Record<string, unknown>
    if (input.action === 'unsubscribe') {
      if (Object.keys(input).some(key => !['action','domainId'].includes(key)) || typeof input.domainId !== 'string') return this.closeWithError(ws, 'invalid_subscription')
      client.subscriptions.delete(input.domainId)
      return this.send(ws, { type: 'unsubscribed', domainId: input.domainId })
    }
    if (input.action !== 'subscribe' || Object.keys(input).some(key => !['action','domainId','filters'].includes(key)) || typeof input.domainId !== 'string' || input.domainId.length > 20 || !/^[1-9]\d*$/.test(input.domainId) || BigInt(input.domainId) > U64) return this.closeWithError(ws, 'invalid_subscription')
    const filters = this.validateFilters(input.filters)
    if (!filters) return this.closeWithError(ws, 'invalid_filters')
    const domainId = input.domainId
    try {
      const owned = await this.db.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT CAST(id AS CHAR) AS id FROM domains WHERE id=CAST(${domainId} AS UNSIGNED) AND user_id=CAST(${client.userId} AS UNSIGNED) AND deleted_at IS NULL LIMIT 1`)
      if (!owned.length) return this.closeWithError(ws, 'domain_not_available')
      if (!client.subscriptions.has(domainId) && client.subscriptions.size >= MAX_SUBSCRIPTIONS_PER_CONNECTION) return this.closeWithError(ws, 'subscription_limit')
      let userSubs = 0
      for (const other of this.clients.values()) if (other.userId === client.userId) userSubs += other.subscriptions.size
      if (!client.subscriptions.has(domainId) && userSubs >= MAX_SUBSCRIPTIONS_PER_USER) return this.closeWithError(ws, 'subscription_limit')
      client.subscriptions.set(domainId, { domainId, filters })
      this.send(ws, { type: 'subscribed', domainId })
    } catch {
      this.closeWithError(ws, 'unavailable')
    }
  }

  private validateFilters(value: unknown): Filters | null {
    if (value === undefined) return {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const input = value as Record<string, unknown>
    if (Object.keys(input).some(key => !['statusCode','ip','url'].includes(key))) return null
    const result: Filters = {}
    if (input.statusCode !== undefined) {
      if (!Array.isArray(input.statusCode) || input.statusCode.length > 20 || input.statusCode.some(code => !Number.isInteger(code) || Number(code) < 100 || Number(code) > 599)) return null
      result.statusCode = [...new Set(input.statusCode as number[])]
    }
    if (input.ip !== undefined) {
      if (typeof input.ip !== 'string' || input.ip.length > 45 || !isIP(input.ip)) return null
      result.ip = input.ip
    }
    if (input.url !== undefined) {
      if (typeof input.url !== 'string' || input.url.length > 128 || [...input.url].some(char => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127)) return null
      result.url = input.url
    }
    return result
  }

  private closeWithError(ws: WebSocket, code: string): void {
    if (ws.readyState === WebSocket.OPEN) this.send(ws, { type: 'error', code })
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1008, 'policy violation')
  }

  private send(ws: WebSocket, message: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
  }

  publish(log: { domainId: string; eventTime: Date; ip: string; url: string; statusCode: number; bytes: string; userAgent: string | null; region: string | null; isp: string | null }): void {
    for (const [ws, client] of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) { this.clients.delete(ws); continue }
      const subscription = client.subscriptions.get(log.domainId)
      if (!subscription) continue
      const f = subscription.filters
      if (f.statusCode && !f.statusCode.includes(log.statusCode)) continue
      if (f.ip && f.ip !== log.ip) continue
      if (f.url && !log.url.includes(f.url)) continue
      this.send(ws, { type: 'log', log: { domainId: log.domainId, time: log.eventTime.toISOString(), ip: log.ip, url: log.url, status: log.statusCode, bytes: log.bytes, userAgent: log.userAgent, region: log.region, isp: log.isp } })
    }
  }

  onModuleDestroy(): void {
    if (this.server && this.upgradeHandler) this.server.off('upgrade', this.upgradeHandler)
    for (const ws of this.clients.keys()) ws.terminate()
    this.clients.clear()
    this.wss?.close()
  }
}
