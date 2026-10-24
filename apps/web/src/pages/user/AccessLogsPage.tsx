import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import { logsApi, type AccessLog, type AccessLogQuery } from '@/api/logs'
import { domainApi } from '@/api/domain'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/common/EmptyState'
import { Loading } from '@/components/common/Loading'
import { PageHeader } from '@/components/common/PageHeader'
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { selectHasPermission, useAuthStore } from '@/stores/auth'

const PAGE_SIZE = 20
const DOMAIN_ALL = '__all_domains__'
const blankFilters = { domainId: '', startTime: '', endTime: '', statusCode: '', ip: '', url: '', userAgent: '' }
type RealtimeStatus = 'stopped' | 'connecting' | 'connected' | 'error'
type RealtimeLog = Pick<AccessLog, 'domainId' | 'ip' | 'url' | 'bytes' | 'region' | 'isp'> & {
  time: string
  status: number
  userAgent?: string | null
}
type RealtimeEntry = { id: number; log: RealtimeLog }
type RealtimeMessage = { type?: string; log?: RealtimeLog; code?: string | number }

function websocketUrl(token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/v1/user/logs/realtime?token=${encodeURIComponent(token)}`
}

export function AccessLogsPage() {
  const { t } = useTranslation()
  const tx = (key: string, fallback: string, options?: Record<string, unknown>) => t(`accessLogs.${key}`, { defaultValue: fallback, ...options })
  const userId = useAuthStore((state) => state.user?.id ?? '')
  const accessToken = useAuthStore((state) => state.accessToken)
  const canRead = useAuthStore(selectHasPermission('log:read'))
  const canExport = useAuthStore(selectHasPermission('log:export'))
  const [filters, setFilters] = useState(blankFilters)
  const [draft, setDraft] = useState(blankFilters)
  const [page, setPage] = useState(1)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState('')
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('stopped')
  const [realtimeError, setRealtimeError] = useState('')
  const [realtimeLogs, setRealtimeLogs] = useState<RealtimeEntry[]>([])
  const socketRef = useRef<WebSocket | null>(null)
  const realtimeIdRef = useRef(0)
  const domains = useQuery({ queryKey: ['user', userId, 'access-logs', 'domains'], queryFn: () => domainApi.list({ page: 1, pageSize: 100 }), enabled: canRead && !!userId })
  const query: AccessLogQuery = { ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)), page, pageSize: PAGE_SIZE + 1 }
  const logs = useQuery({ queryKey: ['user', userId, 'access-logs', query], queryFn: () => logsApi.listAccess(query), enabled: canRead && !!userId })
  const setDraftField = (key: keyof typeof blankFilters, value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const apply = () => { setPage(1); setFilters({ ...draft }) }
  const exportCsv = async () => {
    if (!canExport) return
    setExportBusy(true); setExportError('')
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) as Omit<AccessLogQuery, 'page' | 'pageSize'>
      const blob = await logsApi.exportAccess(params); const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'access-logs.csv'; anchor.click(); URL.revokeObjectURL(url)
    } catch (error) { setExportError(error instanceof ApiError ? error.message : tx('exportFailed', 'Could not export access logs.')) }
    finally { setExportBusy(false) }
  }
  const startRealtime = () => {
    if (!draft.domainId || !accessToken || socketRef.current) return
    setRealtimeLogs([])
    setRealtimeError('')
    setRealtimeStatus('connecting')
    let socket: WebSocket
    try {
      socket = new WebSocket(websocketUrl(accessToken))
    } catch {
      setRealtimeError(tx('realtimeConnectFailed', 'Could not connect to realtime logs. Check that your package includes realtime logs.'))
      setRealtimeStatus('error')
      return
    }
    socketRef.current = socket
    socket.onopen = () => {
      if (socketRef.current !== socket) return
      const statusCode = Number(draft.statusCode)
      const filters = {
        ...(Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? { statusCode: [statusCode] } : {}),
        ...(draft.ip ? { ip: draft.ip } : {}),
        ...(draft.url ? { url: draft.url } : {}),
      }
      try {
        socket.send(JSON.stringify({ action: 'subscribe', domainId: draft.domainId, filters }))
        setRealtimeStatus('connected')
      } catch {
        setRealtimeError(tx('realtimeConnectFailed', 'Could not connect to realtime logs. Check that your package includes realtime logs.'))
        setRealtimeStatus('error')
        socketRef.current = null
        socket.close()
      }
    }
    socket.onmessage = (event) => {
      if (socketRef.current !== socket) return
      try {
        const message = JSON.parse(String(event.data)) as RealtimeMessage
        if (message.type === 'log' && message.log && typeof message.log === 'object') {
          const next = { id: ++realtimeIdRef.current, log: message.log }
          setRealtimeLogs((current) => [...current, next].slice(-100))
        } else if (message.type === 'error') {
          setRealtimeError(tx('realtimeServerError', 'Realtime subscription failed ({{code}}).', { code: String(message.code ?? 'unknown') }))
          setRealtimeStatus('error')
          socketRef.current = null
          socket.close()
        }
      } catch {
        // Ignore malformed frames; only validated JSON objects are rendered.
      }
    }
    socket.onerror = () => {
      if (socketRef.current !== socket) return
      setRealtimeError(tx('realtimeConnectFailed', 'Could not connect to realtime logs. Check that your package includes realtime logs.'))
      setRealtimeStatus('error')
      socketRef.current = null
      socket.close()
    }
    socket.onclose = () => {
      if (socketRef.current !== socket) return
      socketRef.current = null
      setRealtimeStatus((current) => {
        if (current === 'error') return current
        setRealtimeError(tx('realtimeClosed', 'The realtime connection closed. Start it again to reconnect.'))
        return 'error'
      })
    }
  }
  const stopRealtime = () => {
    const socket = socketRef.current
    socketRef.current = null
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
    setRealtimeStatus('stopped')
    setRealtimeError('')
  }
  useEffect(() => () => {
    const socket = socketRef.current
    socketRef.current = null
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
  }, [])

  if (!canRead) return <div className="page-stack"><PageHeader title={tx('title', 'Access logs')} description={tx('description', 'Search recorded HTTP access events.')} /><p role="alert" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{tx('permissionDenied', 'You do not have the log:read permission.')}</p></div>
  const retry = () => void logs.refetch()
  const items = logs.data?.list.slice(0, PAGE_SIZE) ?? []
  const hasNext = (logs.data?.list.length ?? 0) > PAGE_SIZE
  const realtimeStatusLabel = {
    stopped: tx('realtimeStopped', 'Stopped'),
    connecting: tx('realtimeConnecting', 'Connecting…'),
    connected: tx('realtimeConnected', 'Connected'),
    error: tx('realtimeErrorStatus', 'Connection error'),
  }[realtimeStatus]
  return <div className="page-stack">
    <PageHeader title={tx('title', 'Access logs')} description={tx('description', 'Search recorded HTTP access events.')} />
    <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4 md:p-5">
      <div className="form-field"><label htmlFor="logs-domain" className="text-sm font-medium">{tx('domain', 'Domain')}</label><SelectRoot value={draft.domainId || DOMAIN_ALL} onValueChange={(value) => setDraftField('domainId', value === DOMAIN_ALL ? '' : value)}><SelectTrigger id="logs-domain" className="mt-1" aria-label={tx('domain', 'Domain')}><SelectValue placeholder={tx('allDomains', 'All domains')} /></SelectTrigger><SelectContent><SelectItem value={DOMAIN_ALL}>{tx('allDomains', 'All domains')}</SelectItem>{domains.data?.list.map((domain) => <SelectItem value={domain.id} key={domain.id}>{domain.domain}</SelectItem>)}</SelectContent></SelectRoot></div>
      <div className="form-field"><label htmlFor="logs-start" className="text-sm font-medium">{tx('startUtc', 'Start (UTC ISO)')}</label><input id="logs-start" className="mt-1 h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm" placeholder="2026-10-01T00:00:00Z" value={draft.startTime} onChange={(e) => setDraftField('startTime', e.target.value)} /></div>
      <div className="form-field"><label htmlFor="logs-end" className="text-sm font-medium">{tx('endUtc', 'End (UTC ISO)')}</label><input id="logs-end" className="mt-1 h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm" placeholder="2026-10-02T00:00:00Z" value={draft.endTime} onChange={(e) => setDraftField('endTime', e.target.value)} /></div>
      <div className="form-field"><label htmlFor="logs-status" className="text-sm font-medium">{tx('status', 'HTTP status')}</label><input id="logs-status" inputMode="numeric" className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm" value={draft.statusCode} onChange={(e) => setDraftField('statusCode', e.target.value)} /></div>
      <div className="form-field"><label htmlFor="logs-ip" className="text-sm font-medium">{tx('ip', 'IP address')}</label><input id="logs-ip" className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm" value={draft.ip} onChange={(e) => setDraftField('ip', e.target.value)} /></div>
      <div className="form-field"><label htmlFor="logs-url" className="text-sm font-medium">{tx('url', 'URL')}</label><input id="logs-url" className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm" value={draft.url} onChange={(e) => setDraftField('url', e.target.value)} /></div>
      <div className="form-field"><label htmlFor="logs-agent" className="text-sm font-medium">{tx('userAgent', 'User agent')}</label><input id="logs-agent" className="mt-1 h-10 rounded-md border border-input bg-background px-3 text-sm" value={draft.userAgent} onChange={(e) => setDraftField('userAgent', e.target.value)} /></div>
      <div className="flex flex-wrap items-end gap-2"><Button size="sm" onClick={apply}>{tx('applyFilters', 'Apply filters')}</Button><Button size="sm" variant="outline" onClick={() => { setDraft(blankFilters); setFilters(blankFilters); setPage(1) }}>{tx('clearFilters', 'Clear')}</Button><Button size="sm" variant="outline" onClick={retry}>{tx('refresh', 'Refresh')}</Button>{canExport && <Button size="sm" variant="outline" disabled={exportBusy} onClick={() => void exportCsv()}>{exportBusy ? tx('exporting', 'Exporting…') : tx('exportCsv', 'Download CSV')}</Button>}</div>
      {!canExport && <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">{tx('exportDenied', 'log:export permission is required to download CSV.')}</p>}
      {exportError && <p role="alert" className="text-sm text-destructive sm:col-span-2 xl:col-span-4">{exportError}</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{tx('realtimeTitle', 'Realtime access logs')}</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="flex flex-wrap items-center gap-3"><p className="min-w-0 flex-1 text-sm text-muted-foreground">{tx('realtimeDescription', 'Live events are received only after you start a connection. User-agent filtering is not available for realtime subscriptions.')}</p><span role="status" aria-live="polite" className="text-sm font-medium">{realtimeStatusLabel}</span>{realtimeStatus === 'stopped' || realtimeStatus === 'error' ? <Button size="sm" disabled={!draft.domainId || !accessToken || domains.isLoading} onClick={startRealtime}>{tx('startRealtime', 'Start')}</Button> : <Button size="sm" variant="outline" onClick={stopRealtime}>{tx('stopRealtime', 'Stop')}</Button>}</div>
      {!draft.domainId && <p className="text-sm text-muted-foreground">{tx('selectDomainFirst', 'Select a domain above before starting realtime logs.')}</p>}
      {realtimeError && <p role="alert" className="text-sm text-destructive">{realtimeError}</p>}
      {realtimeLogs.length === 0 ? <p className="text-sm text-muted-foreground">{tx('noRealtimeLogs', 'No realtime events received yet.')}</p> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{tx('time', 'Time (UTC)')}</TableHead><TableHead>{tx('ip', 'IP')}</TableHead><TableHead>{tx('url', 'URL')}</TableHead><TableHead>{tx('status', 'Status')}</TableHead><TableHead>{tx('bytes', 'Bytes')}</TableHead><TableHead>{tx('region', 'Region')}</TableHead><TableHead>{tx('isp', 'ISP')}</TableHead><TableHead>{tx('userAgent', 'User agent')}</TableHead></TableRow></TableHeader><TableBody>{realtimeLogs.map(({ id, log }) => <TableRow key={id}><TableCell className="whitespace-nowrap font-mono text-xs">{String(log.time)}</TableCell><TableCell className="whitespace-nowrap font-mono text-xs">{String(log.ip)}</TableCell><TableCell className="min-w-48 break-all font-mono text-xs">{String(log.url)}</TableCell><TableCell className="tabular-nums">{String(log.status)}</TableCell><TableCell className="tabular-nums">{String(log.bytes)}</TableCell><TableCell>{log.region == null ? '—' : String(log.region)}</TableCell><TableCell>{log.isp == null ? '—' : String(log.isp)}</TableCell><TableCell className="min-w-48 break-all text-xs">{log.userAgent == null ? '—' : String(log.userAgent)}</TableCell></TableRow>)}</TableBody></Table></div>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>{tx('results', 'Access events')}</CardTitle></CardHeader><CardContent className="p-0">
      {logs.isLoading ? <Loading label={tx('loading', 'Loading access logs…')} /> : logs.isError ? <div role="alert" className="p-4 text-sm text-destructive"><p>{logs.error instanceof ApiError ? logs.error.message : tx('loadFailed', 'Could not load access logs.')}</p><Button className="mt-3" size="sm" variant="outline" onClick={retry}>{tx('retry', 'Retry')}</Button></div> : items.length === 0 ? <EmptyState title={tx('noResults', 'No access logs match these filters.')} /> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{tx('time', 'Time (UTC)')}</TableHead><TableHead>{tx('domain', 'Domain')}</TableHead><TableHead>{tx('status', 'Status')}</TableHead><TableHead>{tx('ip', 'IP')}</TableHead><TableHead>{tx('url', 'URL')}</TableHead><TableHead>{tx('userAgent', 'User agent')}</TableHead></TableRow></TableHeader><TableBody>{items.map((row) => <TableRow key={row.id}><TableCell className="whitespace-nowrap font-mono text-xs">{row.eventTime}</TableCell><TableCell>{domains.data?.list.find((domain) => domain.id === row.domainId)?.domain ?? row.domainId}</TableCell><TableCell className="tabular-nums">{row.statusCode}</TableCell><TableCell className="whitespace-nowrap font-mono text-xs">{row.ip}</TableCell><TableCell className="min-w-48 break-all font-mono text-xs">{row.url}</TableCell><TableCell className="min-w-48 break-all text-xs">{row.userAgent ?? '—'}</TableCell></TableRow>)}</TableBody></Table></div>}
      {logs.data && <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6"><p className="text-sm text-muted-foreground" aria-live="polite">{tx('page', 'Page')} {page}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>{tx('previous', 'Previous')}</Button><Button variant="outline" size="sm" disabled={!hasNext} onClick={() => setPage((n) => n + 1)}>{tx('next', 'Next')}</Button></div></div>}
    </CardContent></Card>
  </div>
}
