import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import { statisticsApi } from '@/api/statistics'
import { domainApi } from '@/api/domain'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/common/EmptyState'
import { Loading } from '@/components/common/Loading'
import { PageHeader } from '@/components/common/PageHeader'
import { selectHasPermission, useAuthStore } from '@/stores/auth'

const DOMAIN_ALL = '__all_domains__'

function formatBytes(value: string | null, locale: string): string {
  if (value === null) return '—'
  // Group an exact integer with BigInt; never coerce traffic counters to Number.
  // BigIntで整数を正確に桁区切りし、通信量をNumberへ変換しません。
  if (!/^\d+$/.test(value)) return `${value} bytes`
  return `${new Intl.NumberFormat(locale).format(BigInt(value))} bytes`
}

function formatUtcTime(value: string): string {
  // Display UTC explicitly; the data table must not imply the viewer's local timezone.
  // 閲覧者のローカルタイムゾーンと誤認させないようUTCで明示します。
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

export function StatisticsPage() {
  const { t, i18n } = useTranslation()
  const tx = (key: string, fallback: string) => t(`statistics.${key}`, { defaultValue: fallback })
  const userId = useAuthStore((state) => state.user?.id ?? '')
  const canRead = useAuthStore(selectHasPermission('statistics:read'))
  const [domainFilter, setDomainFilter] = useState<{ userId: string; domainId: string }>({ userId: '', domainId: '' })
  // Do not carry a selected domain across user/session changes, even for the first render after a switch.
  // 使用者／工作階段切換時不沿用上一位使用者的域名篩選。
  const domainId = domainFilter.userId === userId ? domainFilter.domainId : ''

  const domains = useQuery({
    queryKey: ['user', userId, 'statistics', 'domains'],
    queryFn: () => domainApi.list({ page: 1, pageSize: 100 }),
    enabled: canRead && !!userId,
  })
  const traffic = useQuery({
    queryKey: ['user', userId, 'statistics', 'traffic', domainId || null, 'hour'],
    queryFn: () => statisticsApi.getTraffic({ domainId: domainId || undefined, granularity: 'hour' }),
    enabled: canRead && !!userId,
  })

  if (!canRead) {
    return <div className="page-stack"><PageHeader title={tx('title', 'Traffic statistics')} description={tx('description', 'Read-only traffic from persisted hourly observations.')} /><p role="alert" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{tx('permissionDenied', 'You do not have the statistics:read permission.')}</p></div>
  }

  const retryAction = (retry: () => void) => <Button size="sm" variant="outline" onClick={retry}>{tx('retry', 'Retry')}</Button>
  const loadFailed = (error: unknown) => error instanceof ApiError && error.message ? error.message : tx('loadFailed', 'Could not load traffic statistics.')

  return (
    <div className="page-stack">
      <PageHeader
        title={tx('title', 'Traffic statistics')}
        description={tx('description', 'Read-only traffic from persisted hourly observations.')}
      />
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>{tx('recentWindow', 'Last 24 completed UTC hours; the current hour is excluded.')}</p>
        {traffic.data && <p className="break-all font-mono text-xs">{formatUtcTime(traffic.data.startTime)} ≤ UTC &lt; {formatUtcTime(traffic.data.endTime)}</p>}
      </div>
      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-[minmax(16rem,24rem)_1fr] md:items-end md:p-6">
          <div className="form-field">
            <label htmlFor="statistics-domain" className="text-sm font-medium">{tx('domain', 'Domain')}</label>
            {domains.isError ? (
              <p role="alert" className="mt-2 text-sm text-destructive">{loadFailed(domains.error)} {retryAction(() => void domains.refetch())}</p>
            ) : domains.isLoading ? <Loading /> : (
              <SelectRoot value={domainId || DOMAIN_ALL} onValueChange={(value) => setDomainFilter({ userId, domainId: value === DOMAIN_ALL ? '' : value })}>
                <SelectTrigger id="statistics-domain" className="mt-1" aria-label={tx('domain', 'Domain')}>
                  <SelectValue placeholder={tx('allDomains', 'All domains')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DOMAIN_ALL}>{tx('allDomains', 'All domains')}</SelectItem>
                  {domains.data?.list.map((domain) => <SelectItem key={domain.id} value={domain.id}>{domain.domain}</SelectItem>)}
                </SelectContent>
              </SelectRoot>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{tx('coverage', 'Only observed intervals are shown; missing intervals are not filled with zero.')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{tx('title', 'Traffic statistics')}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {traffic.isLoading ? <Loading label={tx('loading', 'Loading traffic statistics…')} /> : traffic.isError ? (
            <div role="alert" className="p-4 text-sm text-destructive">
              <p>{loadFailed(traffic.error)}</p>
              <div className="mt-3">{retryAction(() => void traffic.refetch())}</div>
            </div>
          ) : traffic.data?.availability === 'no_data' ? (
            <EmptyState title={tx('noData', 'No collection data has been received yet.')} description={tx('noDataDescription', 'No data is not the same as zero traffic.')} />
          ) : traffic.data ? (
            <div>
              <div className="border-b border-border px-4 py-4 md:px-6">
                <p className="text-sm text-muted-foreground">{tx('total', 'Total traffic')}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{formatBytes(traffic.data.totalBytes, i18n.language)}</p>
              </div>
              {traffic.data.series.length === 0 ? (
                <EmptyState title={tx('noObservedIntervals', 'No observed intervals in this period.')} />
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>{tx('timeUtc', 'Time (UTC)')}</TableHead><TableHead className="text-right">{tx('bytes', 'Bytes')}</TableHead></TableRow></TableHeader>
                  <TableBody>{traffic.data.series.map((point) => (
                    <TableRow key={point.time}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{formatUtcTime(point.time)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBytes(point.bytes, i18n.language)}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              )}
              <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground md:px-6">{tx('coverage', 'Only observed intervals are shown; missing intervals are not filled with zero.')}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
