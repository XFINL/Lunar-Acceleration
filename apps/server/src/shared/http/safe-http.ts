import { lookup as dnsLookup } from 'node:dns/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import { isIP } from 'node:net'
import * as ipaddr from 'ipaddr.js'

export type SafeProbeErrorCode = 'INVALID_TARGET' | 'DNS_FAILED' | 'BLOCKED_ADDRESS' | 'UNSAFE_PORT' | 'TIMEOUT' | 'NETWORK_ERROR'
export interface ProbeAddress { address: string; family: number }
export interface SafeProbeTarget { address: string; port: number; protocol: 'http' | 'https'; hostHeader?: string; path: string }
export interface SafeProbeResult { statusCode: number | null; latencyMs: number; errorCode?: SafeProbeErrorCode }
export interface SafeHttpOptions {
  timeoutMs?: number
  resolver?: (hostname: string) => Promise<ProbeAddress[]>
  transport?: (options: { protocol: 'http:' | 'https:'; hostname: string; port: number; path: string; addresses: ProbeAddress[]; timeoutMs: number; hostHeader: string; servername?: string }) => Promise<number>
}

const SAFE_PORTS = new Set([80, 443, 8080, 8443])
const DEFAULT_TIMEOUT = 3000
const MAX_TIMEOUT = 5000

export function isPublicAddress(address: string): boolean {
  try {
    if (!ipaddr.isValid(address)) return false
    const parsed = ipaddr.parse(address)
    // ipaddr.js labels only globally routable, non-special addresses "unicast".
    // IPv4-mapped IPv6 has a distinct range and is deliberately never accepted.
    if (parsed.kind() === 'ipv6') {
      const v6 = parsed as ipaddr.IPv6
      // ipaddr's fallback "unicast" also includes currently unallocated IPv6 space.
      if (v6.isIPv4MappedAddress() || !v6.match(ipaddr.parse('2000::') as ipaddr.IPv6, 3)) return false
    }
    return parsed.range() === 'unicast'
  } catch { return false }
}

function validDnsName(host: string): boolean {
  return host.length <= 253 && host.length > 0 && !host.endsWith('.') && host.split('.').every(label => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
}

function validPath(path: string): boolean {
  return typeof path === 'string' && path.length > 0 && path.length <= 2048 && path.startsWith('/') && !path.startsWith('//') && !/[\r\n\x00#]/.test(path) && !path.includes('://') && !/[\u0000-\u001f\u007f]/.test(path)
}

async function resolve(hostname: string): Promise<ProbeAddress[]> {
  if (isIP(hostname)) return [{ address: hostname, family: isIP(hostname) }]
  const records = await dnsLookup(hostname, { all: true, verbatim: true })
  return records.map(record => ({ address: record.address, family: record.family }))
}

function nodeTransport(options: Parameters<NonNullable<SafeHttpOptions['transport']>>[0]): Promise<number> {
  return new Promise((resolveStatus, reject) => {
    const module = options.protocol === 'https:' ? https : http
    const request = module.request({
      protocol: options.protocol,
      hostname: options.hostname,
      port: options.port,
      method: 'HEAD',
      path: options.path,
      headers: { Host: options.hostHeader, Connection: 'close' },
      agent: false,
      ...(options.protocol === 'https:' ? { servername: options.servername, rejectUnauthorized: true } : {}),
      // Never re-resolve at connect time: every socket is pinned to the vetted set.
      lookup: (_host, lookupOptions: any, callback: any) => {
        const family = typeof lookupOptions === 'number' ? lookupOptions : lookupOptions?.family
        const chosen = options.addresses.find(item => !family || item.family === family) ?? options.addresses[0]
        if (!chosen) return callback(new Error('no vetted address'))
        if (lookupOptions?.all) callback(null, [{ address: chosen.address, family: chosen.family }])
        else callback(null, chosen.address, chosen.family)
      },
    }, response => {
      const code = response.statusCode ?? 0
      // HEAD response body is intentionally never consumed.
      response.destroy()
      resolveStatus(code)
    })
    // Socket inactivity timeouts alone can be extended forever by slow header bytes.
    const deadline = setTimeout(() => request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), options.timeoutMs)
    request.once('close', () => clearTimeout(deadline))
    request.on('error', reject)
    request.setTimeout(options.timeoutMs, () => request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    request.end()
  })
}

/** Bounded HEAD probe. It never follows redirects, reads response bodies, or exposes network error text. */
export async function safeHttpProbe(target: SafeProbeTarget, options: SafeHttpOptions = {}): Promise<SafeProbeResult> {
  const started = Date.now()
  const fail = (errorCode: SafeProbeErrorCode): SafeProbeResult => ({ statusCode: null, latencyMs: Math.max(0, Date.now() - started), errorCode })
  if (!target || (target.protocol !== 'http' && target.protocol !== 'https') || !validPath(target.path) || !Number.isInteger(target.port) || !SAFE_PORTS.has(target.port)) return fail(target && Number.isInteger(target.port) && !SAFE_PORTS.has(target.port) ? 'UNSAFE_PORT' : 'INVALID_TARGET')
  const hostname = typeof target.address === 'string' ? target.address.toLowerCase().replace(/\.$/, '') : ''
  if (!(isIP(hostname) || validDnsName(hostname))) return fail('INVALID_TARGET')
  const hostHeader = target.hostHeader ?? hostname
  if (typeof hostHeader !== 'string' || !(isIP(hostHeader) || validDnsName(hostHeader)) || /[\r\n]/.test(hostHeader)) return fail('INVALID_TARGET')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT) return fail('INVALID_TARGET')
  let addresses: ProbeAddress[]
  let dnsTimer: ReturnType<typeof setTimeout> | undefined
  try {
    addresses = await Promise.race([
      (options.resolver ?? resolve)(hostname),
      new Promise<never>((_, reject) => { dnsTimer = setTimeout(() => reject(Object.assign(new Error(), { code: 'ETIMEDOUT' })), timeoutMs) }),
    ])
  } catch (error) { return fail((error as any)?.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'DNS_FAILED') }
  finally { if (dnsTimer) clearTimeout(dnsTimer) }
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(item => !item || !isPublicAddress(item.address))) return fail('BLOCKED_ADDRESS')
  const remainingMs = timeoutMs - (Date.now() - started)
  if (remainingMs <= 0) return fail('TIMEOUT')
  try {
    let transportTimer: ReturnType<typeof setTimeout> | undefined
    try {
      const statusCode = await Promise.race([
        (options.transport ?? nodeTransport)({ protocol: `${target.protocol}:`, hostname, port: target.port, path: target.path, addresses, timeoutMs: remainingMs, hostHeader, ...(target.protocol === 'https' ? { servername: !isIP(hostHeader) ? hostHeader : (!isIP(hostname) ? hostname : undefined) } : {}) }),
        new Promise<never>((_, reject) => { transportTimer = setTimeout(() => reject(Object.assign(new Error(), { code: 'ETIMEDOUT' })), remainingMs) }),
      ])
      return { statusCode, latencyMs: Math.max(0, Date.now() - started) }
    } finally { if (transportTimer) clearTimeout(transportTimer) }
  } catch (error) {
    return fail((error as any)?.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'NETWORK_ERROR')
  }
}
