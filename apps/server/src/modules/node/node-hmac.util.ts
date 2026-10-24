import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Stored tokenHash is SHA256(raw token) hex and its 32 raw digest bytes are the HMAC key. */
export function createNodeSignature(
  tokenHash: string,
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  rawBody: Buffer,
): string {
  const message = `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${sha256Hex(rawBody)}`
  return createHmac('sha256', Buffer.from(tokenHash, 'hex')).update(message, 'utf8').digest('hex')
}

export function safeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(left) || !/^[0-9a-fA-F]{64}$/.test(right)) return false
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
