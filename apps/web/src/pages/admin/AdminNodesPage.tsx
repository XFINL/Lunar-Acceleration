import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import { adminNodeApi, type NodeMetric, type NodePayload, type NodeRecord } from '@/api/nodes'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/common/EmptyState'
import { Loading } from '@/components/common/Loading'
import { PageHeader } from '@/components/common/PageHeader'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { selectHasPermission, useAuthStore } from '@/stores/auth'

const initialForm = { name: '', ip: '', port: '443', region: '', isp: '', nodeGroupId: '', weight: '1', bandwidthMbps: '' }

type OneTimeSecret = { token: string; nodeName: string }

function listFromResponse<T>(response: T[] | { list?: T[] } | { metrics?: T[] }): T[] {
  if (Array.isArray(response)) return response
  if ('list' in response && Array.isArray(response.list)) return response.list
  if ('metrics' in response && Array.isArray(response.metrics)) return response.metrics
  return []
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback
}

function oneTimeToken(response: { nodeToken?: string; token?: string }): string {
  const token = response.nodeToken ?? response.token
  if (!token) throw new Error('The server did not return a node token.')
  return token
}

function nodeStatus(status: NodeRecord['status'], t: (key: string, options?: Record<string, unknown>) => string): string {
  if (status === 1 || status === 'online' || status === 'active' || status === 'healthy') return t('m6Nodes.online')
  if (status === 0 || status === 'disabled') return t('m6Nodes.disabled')
  if (status === 2 || status === 'offline' || status === 'inactive' || status === 'unhealthy') return t('m6Nodes.offline')
  if (status === 3 || status === 'maintenance') return t('m6Nodes.maintenance')
  if (status === 4 || status === 'deploying') return t('m6Nodes.deploying')
  return typeof status === 'string' && status ? status : t('m6Nodes.unknown')
}

function metricTime(metric: NodeMetric): string {
  const value = metric.timestamp ?? metric.time ?? metric.recordedAt ?? metric.statTime
  if (typeof value !== 'string' || !value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function metricValue(metric: NodeMetric, fields: string[]): string {
  for (const field of fields) {
    const value = metric[field]
    if (typeof value === 'number' || typeof value === 'string') return String(value)
  }
  return '—'
}

export function AdminNodesPage() {
  const { t } = useTranslation()
  const tx = (key: string) => t(`m6Nodes.${key}`)
  const canRead = useAuthStore(selectHasPermission('node:read'))
  const canCreate = useAuthStore(selectHasPermission('node:create'))
  const canUpdate = useAuthStore(selectHasPermission('node:update'))
  const canMonitor = canRead
  const queryClient = useQueryClient()
  const [form, setForm] = useState(initialForm)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [oneTimeSecret, setOneTimeSecret] = useState<OneTimeSecret | null>(null)
  const [copyMessage, setCopyMessage] = useState('')
  const [metricsNodeId, setMetricsNodeId] = useState<string | null>(null)

  const nodesQuery = useQuery({
    queryKey: ['admin', 'nodes'],
    queryFn: async () => listFromResponse(await adminNodeApi.list()),
    enabled: canRead,
  })
  const metricsQuery = useQuery({
    queryKey: ['admin', 'nodes', metricsNodeId, 'metrics'],
    queryFn: async () => listFromResponse(await adminNodeApi.metrics(metricsNodeId!)),
    enabled: canMonitor && Boolean(metricsNodeId),
  })

  const setField = (field: keyof typeof initialForm, value: string) => setForm((current) => ({ ...current, [field]: value }))
  const readableError = (error: unknown) => errorText(error, t('common.failed'))

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    setActionError('')
    setCopyMessage('')
    setOneTimeSecret(null)
    const payload: NodePayload = {
      name: form.name.trim(),
      ip: form.ip.trim(),
      port: Number(form.port),
      ...(form.region.trim() ? { region: form.region.trim() } : {}),
      ...(form.isp.trim() ? { isp: form.isp.trim() } : {}),
      ...(form.nodeGroupId.trim() ? { nodeGroupId: form.nodeGroupId.trim() } : {}),
      ...(form.weight !== '' ? { weight: Number(form.weight) } : {}),
      ...(form.bandwidthMbps !== '' ? { bandwidthMbps: Number(form.bandwidthMbps) } : {}),
    }
    setBusy(true)
    try {
      const created = await adminNodeApi.create(payload)
      setOneTimeSecret({ token: oneTimeToken(created), nodeName: created.name || payload.name })
      setForm(initialForm)
      await queryClient.invalidateQueries({ queryKey: ['admin', 'nodes'] })
    } catch (error) {
      setFormError(readableError(error))
    } finally {
      setBusy(false)
    }
  }

  async function rotateToken(node: NodeRecord) {
    setBusy(true)
    setActionError('')
    setCopyMessage('')
    setOneTimeSecret(null)
    try {
      const result = await adminNodeApi.rotateToken(node.id)
      setOneTimeSecret({ token: oneTimeToken(result), nodeName: node.name })
    } catch (error) {
      setActionError(readableError(error))
    } finally {
      setBusy(false)
    }
  }

  async function copyToken() {
    if (!oneTimeSecret) return
    setCopyMessage('')
    try {
      await navigator.clipboard.writeText(oneTimeSecret.token)
      setCopyMessage(tx('copied'))
    } catch {
      setCopyMessage(tx('copyFailed'))
    }
  }

  const noAccess = !canRead && !canCreate && !canUpdate
  return (
    <div className="page-stack">
      <PageHeader title={tx('title')} description={tx('description')} />
      {noAccess ? (
        <Card><CardContent className="p-4 text-sm text-destructive" role="alert">{tx('permissionDenied')}</CardContent></Card>
      ) : (
        <>
          <p className="notice text-sm text-muted-foreground">{tx('scopeNotice')}</p>
          {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
          {oneTimeSecret && (
            <Card className="border-border">
              <CardHeader className="pb-2"><CardTitle>{tx('secretTitle')}</CardTitle></CardHeader>
              <CardContent className="space-y-3 pt-0">
                <p className="text-sm font-medium">{tx('secretWarning')}</p>
                <p className="text-sm text-muted-foreground">{tx('secretFor')}: {oneTimeSecret.nodeName}</p>
                <code data-testid="node-token" className="block max-w-full break-all rounded-xl border border-border/60 bg-muted/40 p-3 font-mono text-sm">{oneTimeSecret.token}</code>
                <div className="control-row flex-wrap">
                  <Button type="button" variant="outline" onClick={() => void copyToken()}>{tx('copyToken')}</Button>
                  <Button type="button" variant="ghost" onClick={() => { setOneTimeSecret(null); setCopyMessage('') }}>{tx('dismissSecret')}</Button>
                  {copyMessage && <span role="status" className="text-sm text-muted-foreground">{copyMessage}</span>}
                </div>
              </CardContent>
            </Card>
          )}

          {canCreate && (
            <Card>
              <CardHeader><CardTitle>{tx('createTitle')}</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <form className="space-y-4" onSubmit={(event) => void submitCreate(event)}>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="form-field"><Label htmlFor="node-name">{tx('name')}</Label><Input id="node-name" required maxLength={64} value={form.name} onChange={(event) => setField('name', event.target.value)} /></div>
                    <div className="form-field"><Label htmlFor="node-ip">{tx('ip')}</Label><Input id="node-ip" required maxLength={255} value={form.ip} onChange={(event) => setField('ip', event.target.value)} /></div>
                    <div className="form-field"><Label htmlFor="node-port">{tx('port')}</Label><Input id="node-port" type="number" required min={1} max={65535} value={form.port} onChange={(event) => setField('port', event.target.value)} /></div>
                    <div className="form-field"><Label htmlFor="node-region">{tx('region')}</Label><Input id="node-region" maxLength={64} value={form.region} onChange={(event) => setField('region', event.target.value)} /></div>
                    <div className="form-field"><Label htmlFor="node-isp">{tx('isp')}</Label><Input id="node-isp" maxLength={64} value={form.isp} onChange={(event) => setField('isp', event.target.value)} /></div>
                    <div className="form-field"><Label htmlFor="node-group">{tx('nodeGroupId')}</Label><Input id="node-group" maxLength={120} value={form.nodeGroupId} onChange={(event) => setField('nodeGroupId', event.target.value)} /></div>
                    <div className="form-field"><Label htmlFor="node-weight">{tx('weight')}</Label><Input id="node-weight" type="number" min={1} value={form.weight} onChange={(event) => setField('weight', event.target.value)} /></div>
                    <div className="form-field"><Label htmlFor="node-bandwidth">{tx('bandwidth')}</Label><Input id="node-bandwidth" type="number" min={1} value={form.bandwidthMbps} onChange={(event) => setField('bandwidthMbps', event.target.value)} /></div>
                  </div>
                  {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
                  <Button type="submit" disabled={busy}>{busy ? tx('working') : tx('createNode')}</Button>
                </form>
              </CardContent>
            </Card>
          )}

          {canRead && (
            <Card>
              <CardHeader className="pb-3"><CardTitle>{tx('listTitle')}</CardTitle></CardHeader>
              <CardContent className="p-0">
                {nodesQuery.isLoading ? <div className="p-4"><Loading /></div> : nodesQuery.isError ? (
                  <div className="space-y-3 p-4" role="alert"><p className="text-sm text-destructive">{readableError(nodesQuery.error)}</p><Button type="button" variant="outline" size="sm" onClick={() => void nodesQuery.refetch()}>{tx('retry')}</Button></div>
                ) : !nodesQuery.data?.length ? (
                  <EmptyState title={tx('emptyTitle')} description={tx('emptyDescription')} />
                ) : (
                  <Table aria-label={tx('listTitle')}>
                    <TableHeader><TableRow><TableHead>{tx('name')}</TableHead><TableHead>{tx('ip')}</TableHead><TableHead>{tx('region')}</TableHead><TableHead>{tx('status')}</TableHead><TableHead>{tx('lastHeartbeat')}</TableHead><TableHead>{t('common.actions')}</TableHead></TableRow></TableHeader>
                    <TableBody>{nodesQuery.data.map((node) => (
                      <TableRow key={node.id}>
                        <TableCell className="font-medium">{node.name}</TableCell>
                        <TableCell className="font-mono text-xs">{node.ip}{node.port ? `:${node.port}` : ''}</TableCell>
                        <TableCell>{node.region || '—'}</TableCell>
                        <TableCell>{nodeStatus(node.status, t)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{(node.lastHeartbeatAt || node.lastHeartbeat) ? metricTime({ timestamp: node.lastHeartbeatAt || node.lastHeartbeat || undefined }) : '—'}</TableCell>
                        <TableCell><div className="data-actions">
                          {canMonitor && <Button type="button" size="sm" variant={metricsNodeId === node.id ? 'default' : 'outline'} onClick={() => setMetricsNodeId((current) => current === node.id ? null : node.id)}>{tx('metrics')}</Button>}
                          {canUpdate && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void rotateToken(node)}>{tx('rotateToken')}</Button>}
                        </div></TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          {canMonitor && metricsNodeId && (
            <Card>
              <CardHeader className="flex-row items-center justify-between"><CardTitle>{tx('metricsTitle')}</CardTitle><Button type="button" variant="ghost" size="sm" onClick={() => setMetricsNodeId(null)}>{tx('closeMetrics')}</Button></CardHeader>
              <CardContent className="p-0">
                {metricsQuery.isLoading ? <div className="p-4"><Loading /></div> : metricsQuery.isError ? (
                  <div className="space-y-3 p-4" role="alert"><p className="text-sm text-destructive">{readableError(metricsQuery.error)}</p><Button type="button" variant="outline" size="sm" onClick={() => void metricsQuery.refetch()}>{tx('retry')}</Button></div>
                ) : !metricsQuery.data?.length ? <EmptyState title={tx('noMetrics')} /> : (
                  <Table aria-label={tx('metricsTitle')}>
                    <TableHeader><TableRow><TableHead>{tx('time')}</TableHead><TableHead>{tx('cpu')}</TableHead><TableHead>{tx('memory')}</TableHead><TableHead>{tx('disk')}</TableHead><TableHead>{tx('bandwidthIn')}</TableHead><TableHead>{tx('bandwidthOut')}</TableHead><TableHead>{tx('connections')}</TableHead><TableHead>{tx('qps')}</TableHead><TableHead>{tx('cacheHitRate')}</TableHead></TableRow></TableHeader>
                    <TableBody>{metricsQuery.data.map((metric, index) => <TableRow key={`${metric.timestamp ?? metric.time ?? metric.statTime ?? 'metric'}-${index}`}><TableCell className="whitespace-nowrap text-xs">{metricTime(metric)}</TableCell><TableCell>{metricValue(metric, ['cpuUsage', 'cpuPercent', 'cpu'])}</TableCell><TableCell>{metricValue(metric, ['memoryUsage', 'memoryPercent', 'mem'])}</TableCell><TableCell>{metricValue(metric, ['disk'])}</TableCell><TableCell>{metricValue(metric, ['bandwidthIn', 'inboundMbps', 'bandwidthMbps'])}</TableCell><TableCell>{metricValue(metric, ['bandwidthOut', 'outboundMbps'])}</TableCell><TableCell>{metricValue(metric, ['connections'])}</TableCell><TableCell>{metricValue(metric, ['qps'])}</TableCell><TableCell>{metricValue(metric, ['cacheHitRate'])}</TableCell></TableRow>)}</TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
