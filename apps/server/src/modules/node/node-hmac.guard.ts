import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { ErrorCode } from '@lunar/shared'
import { Prisma } from '@prisma/client'
import type { Request } from 'express'
import { PrismaService } from '../../database/prisma.service'
import { BusinessException } from '../../common/exceptions/business.exception'
import { createNodeSignature, safeHexEqual } from './node-hmac.util'

const UINT64_MAX = 18446744073709551615n
const reject = () => new BusinessException(ErrorCode.UNAUTHORIZED)

type SignedRequest = Request & { rawBody?: Buffer; originalUrl: string; nodeId?: bigint }

@Injectable()
export class NodeHmacGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SignedRequest>()
    if (request.method !== 'POST') throw reject()
    const path = request.originalUrl.split('?')[0]
    if (path !== '/api/v1/node/heartbeat' && path !== '/api/v1/node/report-metrics') throw reject()
    const nodeIdText = this.header(request, 'x-node-id')
    const timestamp = this.header(request, 'x-node-timestamp')
    const nonce = this.header(request, 'x-node-nonce')
    const signature = this.header(request, 'x-node-signature')
    if (!nodeIdText || !/^(0|[1-9][0-9]{0,19})$/.test(nodeIdText)) throw reject()
    let nodeId: bigint
    try { nodeId = BigInt(nodeIdText) } catch { throw reject() }
    if (nodeId < 1n || nodeId > UINT64_MAX) throw reject()
    if (!timestamp || !/^\d{10}$/.test(timestamp)) throw reject()
    if (!nonce || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw reject()
    if (!signature || !/^[0-9a-fA-F]{64}$/.test(signature)) throw reject()
    const seconds = Number(timestamp)
    if (Math.abs(Math.floor(Date.now() / 1000) - seconds) > 300) throw reject()
    if (!request.rawBody || !Buffer.isBuffer(request.rawBody)) throw reject()

    const token = await this.prisma.nodeToken.findUnique({ where: { nodeId } })
    const now = new Date()
    if (!token || token.status !== 1 || (token.expireAt !== null && token.expireAt <= now)) throw reject()
    const expected = createNodeSignature(token.tokenHash, timestamp, nonce, request.method, path, request.rawBody)
    if (!safeHexEqual(signature, expected)) throw reject()

    // Only a fully authenticated request consumes the nonce. The DB unique key makes this safe across workers/restarts.
    try {
      await this.prisma.nodeRequestNonce.create({ data: { nodeId, nonce, expiresAt: new Date(now.getTime() + 10 * 60_000) } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw reject()
      throw error
    }
    request.nodeId = nodeId
    return true
  }

  private header(request: Request, name: string): string | null {
    const value = request.headers[name]
    return typeof value === 'string' ? value : null
  }
}
