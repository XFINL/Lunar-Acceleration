import { useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/api/client'
import { statisticsApi, type BreakdownReport, type MetricReport, type StatisticsPeriod, type StatisticsReportName, type TrafficGranularity } from '@/api/statistics'
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
const METRIC_REPORTS: Array<{ key: string; report: StatisticsReportName }> = [
  { key: 'bandwidth', report: 'bandwidth' }, { key: 'requests', report: 'requests' }, { key: 'hitRate', report: 'hitrate' },
]
const BREAKDOWN_REPORTS: Array<{ key: string; report: StatisticsReportName }> = [
  { key: 'httpStatus', report: 'status-code' }, { key: 'regions', report: 'region' }, { key: 'isps', report: 'isp' }, { key: 'topUrls', report: 'top-url' }, { key: 'topIps', report: 'top-ip' },
]
function formatInteger(value: string | null | undefined, locale: string, suffix = ''): string {
  if (value == null || !/^\d+$/.test(value)) return '—'
  return `${new Intl.NumberFormat(locale).format(BigInt(value))}${suffix}`
}
function formatBytes(value: string | null, locale: string): string { return value === null ? '—' : `${formatInteger(value, locale)} bytes` }
function formatUtcTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toISOString() }
function utcStamp(date: Date) { return date.toISOString().replace('.000Z', 'Z') }
function currentPeriodRange(period: 'day' | 'week' | 'month') {
  const end = new Date(); end.setUTCHours(0, 0, 0, 0)
  const start = new Date(end)
  if (period === 'day') start.setUTCDate(start.getUTCDate() - 30)
  if (period === 'week') { end.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7)); start.setTime(end.getTime()); start.setUTCDate(start.getUTCDate() - 28) }
  if (period === 'month') { end.setUTCDate(1); start.setTime(end.getTime()); start.setUTCMonth(start.getUTCMonth() - 6) }
  return { startTime: utcStamp(start), endTime: utcStamp(end) }
}
function aggregateSeries(points: Array<{ time: string; bytes: string }>, period: StatisticsPeriod) {
  if (period === 'hour' || period === 'day') return points
  const buckets = new Map<string, bigint>()
  for (const point of points) {
    const date = new Date(point.time)
    if (period === 'week') { date.setUTCHours(0, 0, 0, 0); date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)) }
    else { date.setUTCDate(1); date.setUTCHours(0, 0, 0, 0) }
    const key = date.toISOString(); buckets.set(key, (buckets.get(key) ?? 0n) + BigInt(point.bytes))
  }
  return [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([time, bytes]) => ({ time, bytes: bytes.toString() }))
}
function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url)
}
function errorMessage(error: unknown, fallback: string) { return error instanceof ApiError && error.message ? error.message : fallback }

export function StatisticsPage() {
  const { t, i18n } = useTranslation()
  const tx = (key: string, fallback: string) => t(`statistics.${key}`, { defaultValue: fallback })
  const userId = useAuthStore((state) => state.user?.id ?? '')
  const canRead = useAuthStore(selectHasPermission('statistics:read'))
  const canExport = useAuthStore(selectHasPermission('statistics:export'))
  const [domainFilter, setDomainFilter] = useState<{ userId: string; domainId: string }>({ userId: '', domainId: '' })
  const [period, setPeriod] = useState<StatisticsPeriod>('hour')
  const [startInput, setStartInput] = useState(''); const [endInput, setEndInput] = useState('')
  const [rangeError, setRangeError] = useState(''); const [exportError, setExportError] = useState('')
  const [appliedRange, setAppliedRange] = useState<{ startTime: string; endTime: string } | null>(null)
  const domainId = domainFilter.userId === userId ? domainFilter.domainId : ''
  const domains = useQuery({ queryKey: ['user', userId, 'statistics', 'domains'], queryFn: () => domainApi.list({ page: 1, pageSize: 100 }), enabled: canRead && !!userId })
  const range = appliedRange ?? (period === 'hour' ? null : currentPeriodRange(period))
  const requestParams = { domainId: domainId || undefined, granularity: period, ...(range ?? {}) }
  const traffic = useQuery({
    queryKey: ['user', userId, 'statistics', 'traffic', domainId || null, period, range?.startTime ?? null, range?.endTime ?? null],
    queryFn: async () => {
      if (period === 'week' || period === 'month') {
        const report = await statisticsApi.getReport('traffic', requestParams) as MetricReport
        return { granularity: 'day' as TrafficGranularity, startTime: report.startTime, endTime: report.endTime, unit: 'bytes' as const, source: 'persisted_hourly' as const, coverage: 'observed_only' as const, availability: report.series.length ? 'available' as const : 'no_data' as const, series: report.series.map((point) => ({ time: point.time, bytes: point.value })), totalBytes: report.series.length ? report.total : null }
      }
      return statisticsApi.getTraffic({ domainId: domainId || undefined, granularity: period as TrafficGranularity, ...(range ?? {}) })
    }, enabled: canRead && !!userId,
  })
  const metricQueries = useQueries({ queries: METRIC_REPORTS.map(({ report }) => ({
    queryKey: ['user', userId, 'statistics', report, domainId || null, period, range?.startTime ?? null, range?.endTime ?? null],
    queryFn: () => statisticsApi.getReport(report, requestParams) as Promise<MetricReport>, enabled: canRead && !!userId,
  })) })
  const breakdownQueries = useQueries({ queries: BREAKDOWN_REPORTS.map(({ report }) => ({
    queryKey: ['user', userId, 'statistics', report, domainId || null, period, range?.startTime ?? null, range?.endTime ?? null],
    queryFn: () => statisticsApi.getReport(report, requestParams) as Promise<BreakdownReport>, enabled: canRead && !!userId,
  })) })
  const displaySeries = useMemo(() => traffic.data ? aggregateSeries(traffic.data.series, period) : [], [traffic.data, period])

  if (!canRead) return <div className="page-stack"><PageHeader title={tx('title', 'Statistics')} description={tx('description', 'Observed statistics only; unavailable metrics are not estimated.')} /><p role="alert" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{tx('permissionDenied', 'You do not have the statistics:read permission.')}</p></div>
  const retryAction = (retry: () => void) => <Button size="sm" variant="outline" onClick={retry}>{tx('retry', 'Retry')}</Button>
  const fallbackError = tx('loadFailed', 'Could not load statistics.')
  const applyRange = () => {
    setRangeError('');
    if (!startInput || !endInput) { setRangeError(tx('rangeRequired', 'Enter both UTC start and end times.')); return }
    if (!/Z$/.test(startInput) || !/Z$/.test(endInput)) { setRangeError(tx('utcOnly', 'Use ISO timestamps ending in Z for UTC.')); return }
    const start = new Date(startInput); const end = new Date(endInput)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) { setRangeError(tx('invalidRange', 'Enter a valid UTC range with start before end.')); return }
    setAppliedRange({ startTime: start.toISOString(), endTime: end.toISOString() })
  }
  const clearRange = () => { setStartInput(''); setEndInput(''); setAppliedRange(null); setRangeError('') }
  const exportCsv = async () => {
    if (!canExport) return
    setExportError('')
    try { const blob = await statisticsApi.exportCsv({ ...requestParams, report: 'traffic' }); downloadBlob('statistics-traffic.csv', blob) }
    catch (error) { setExportError(errorMessage(error, fallbackError)) }
  }
  const metricPanel = (item: { key: string; report: StatisticsReportName }, index: number) => {
    const query = metricQueries[index]; const data = query.data as MetricReport | undefined
    let display = data ? formatInteger(data.total, i18n.language, item.key === 'bandwidth' ? ' bytes/s' : '') : ''
    if (item.key === 'hitRate' && data?.series.length) {
      const hits = data.series.reduce((sum, point) => sum + BigInt(point.hit ?? '0'), 0n)
      const misses = data.series.reduce((sum, point) => sum + BigInt(point.miss ?? '0'), 0n)
      display = hits + misses === 0n ? '0%' : `${Number(hits * 10000n / (hits + misses)) / 100}%`
    }
    return <Card key={item.key}><CardHeader className="pb-2"><CardTitle className="text-sm">{tx(item.key, item.key)}</CardTitle></CardHeader><CardContent>
      {query.isLoading ? <Loading /> : query.isError ? <div role="alert" className="text-sm text-destructive">{errorMessage(query.error, fallbackError)}<div className="mt-2">{retryAction(() => void query.refetch())}</div></div> : data?.series.length ? <p className="text-xl font-semibold tabular-nums">{display}</p> : <p className="text-sm text-muted-foreground">{tx('noData', 'No collection data has been received yet.')}</p>}
    </CardContent></Card>
  }
  const breakdownPanel = (item: { key: string; report: StatisticsReportName }, index: number) => {
    const query = breakdownQueries[index]; const data = query.data as BreakdownReport | undefined
    return <Card key={item.key}><CardHeader className="pb-2"><CardTitle className="text-sm">{tx(item.key, item.key)}</CardTitle></CardHeader><CardContent className="p-0">
      {query.isLoading ? <Loading /> : query.isError ? <div role="alert" className="p-4 text-sm text-destructive">{errorMessage(query.error, fallbackError)}<div className="mt-2">{retryAction(() => void query.refetch())}</div></div> : data?.items.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{tx('dimension', 'Value')}</TableHead><TableHead className="text-right">{tx('requests', 'Requests')}</TableHead></TableRow></TableHeader><TableBody>{data.items.map((row) => <TableRow key={row.key}><TableCell className="max-w-64 break-all font-mono text-xs">{row.key}</TableCell><TableCell className="text-right tabular-nums">{formatInteger(row.requests, i18n.language)}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="p-4 text-sm text-muted-foreground">{tx('noData', 'No collection data has been received yet.')}</p>}
    </CardContent></Card>
  }
  return <div className="page-stack">
    <PageHeader title={tx('title', 'Statistics')} description={tx('description', 'Observed statistics only; unavailable metrics are not estimated.')} />
    <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4 md:p-5">
      <div className="form-field"><label htmlFor="statistics-domain" className="text-sm font-medium">{tx('domain', 'Domain')}</label>{domains.isError ? <p role="alert" className="text-sm text-destructive">{errorMessage(domains.error, fallbackError)} {retryAction(() => void domains.refetch())}</p> : domains.isLoading ? <Loading /> : <SelectRoot value={domainId || DOMAIN_ALL} onValueChange={(value) => setDomainFilter({ userId, domainId: value === DOMAIN_ALL ? '' : value })}><SelectTrigger id="statistics-domain" className="mt-1" aria-label={tx('domain', 'Domain')}><SelectValue placeholder={tx('allDomains', 'All domains')} /></SelectTrigger><SelectContent><SelectItem value={DOMAIN_ALL}>{tx('allDomains', 'All domains')}</SelectItem>{domains.data?.list.map((domain) => <SelectItem key={domain.id} value={domain.id}>{domain.domain}</SelectItem>)}</SelectContent></SelectRoot>}</div>
      <div className="form-field"><label htmlFor="statistics-period" className="text-sm font-medium">{tx('period', 'Time granularity')}</label><SelectRoot value={period} onValueChange={(value) => { setPeriod(value as StatisticsPeriod); setAppliedRange(null) }}><SelectTrigger id="statistics-period" className="mt-1" aria-label={tx('period', 'Time granularity')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hour">{tx('hour', 'Hour')}</SelectItem><SelectItem value="day">{tx('day', 'Day')}</SelectItem><SelectItem value="week">{tx('week', 'Week')}</SelectItem><SelectItem value="month">{tx('month', 'Month')}</SelectItem></SelectContent></SelectRoot></div>
      <div className="form-field"><label htmlFor="statistics-start" className="text-sm font-medium">{tx('startUtc', 'Start (UTC ISO)')}</label><input id="statistics-start" className="mt-1 h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm" placeholder="2026-10-01T00:00:00Z" value={startInput} onChange={(event) => setStartInput(event.target.value)} /></div>
      <div className="form-field"><label htmlFor="statistics-end" className="text-sm font-medium">{tx('endUtc', 'End (UTC ISO, exclusive)')}</label><input id="statistics-end" className="mt-1 h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm" placeholder="2026-10-02T00:00:00Z" value={endInput} onChange={(event) => setEndInput(event.target.value)} /></div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-4"><Button variant="outline" size="sm" onClick={applyRange}>{tx('applyRange', 'Apply UTC range')}</Button><Button variant="ghost" size="sm" onClick={clearRange}>{tx('clearRange', 'Clear range')}</Button>{canExport && <Button size="sm" variant="outline" disabled={!traffic.data || traffic.data.availability !== 'available'} onClick={() => void exportCsv()}>{tx('exportCsv', 'Download CSV')}</Button>}<span className="text-xs text-muted-foreground">{tx('utcHint', 'Times are UTC; end time is exclusive. Missing intervals are not filled with zero.')}</span></div>
      {rangeError && <p role="alert" className="text-sm text-destructive sm:col-span-2 xl:col-span-4">{rangeError}</p>}{exportError && <p role="alert" className="text-sm text-destructive sm:col-span-2 xl:col-span-4">{exportError}</p>}
      {!canExport && <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">{tx('exportDenied', 'statistics:export permission is required to download CSV.')}</p>}
    </CardContent></Card>
    {range && <p className="break-all font-mono text-xs text-muted-foreground">{formatUtcTime(range.startTime)} ≤ UTC &lt; {formatUtcTime(range.endTime)}</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{tx('total', 'Total traffic')}</CardTitle></CardHeader><CardContent>{traffic.isLoading ? <Loading label={tx('loading', 'Loading traffic statistics…')} /> : traffic.isError ? <div role="alert" className="text-sm text-destructive">{errorMessage(traffic.error, fallbackError)}<div className="mt-2">{retryAction(() => void traffic.refetch())}</div></div> : traffic.data?.availability === 'available' ? <p className="text-xl font-semibold tabular-nums">{formatBytes(traffic.data.totalBytes, i18n.language)}</p> : <p className="text-sm text-muted-foreground">{tx('noData', 'No collection data has been received yet.')}</p>}</CardContent></Card>
      {METRIC_REPORTS.map(metricPanel)}
    </div>
    <Card><CardHeader><CardTitle>{tx('trafficSeries', 'Traffic by observed interval')}</CardTitle></CardHeader><CardContent className="p-0">
      {traffic.isLoading ? <Loading label={tx('loading', 'Loading traffic statistics…')} /> : traffic.isError ? <div role="alert" className="p-4 text-sm text-destructive">{errorMessage(traffic.error, fallbackError)}<div className="mt-3">{retryAction(() => void traffic.refetch())}</div></div> : traffic.data?.availability === 'no_data' ? <EmptyState title={tx('noData', 'No collection data has been received yet.')} description={tx('noDataDescription', 'No data is not the same as zero traffic.')} /> : traffic.data ? displaySeries.length === 0 ? <EmptyState title={tx('noObservedIntervals', 'No observed intervals in this period.')} /> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{tx('timeUtc', 'Time (UTC)')}</TableHead><TableHead className="text-right">{tx('bytes', 'Bytes')}</TableHead></TableRow></TableHeader><TableBody>{displaySeries.map((point) => <TableRow key={point.time}><TableCell className="whitespace-nowrap font-mono text-xs">{formatUtcTime(point.time)}</TableCell><TableCell className="text-right tabular-nums">{formatBytes(point.bytes, i18n.language)}</TableCell></TableRow>)}</TableBody></Table></div> : null}
      <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{tx('coverage', 'Only observed intervals are shown; missing intervals are not filled with zero.')}</p>
    </CardContent></Card>
    <div className="grid gap-3 md:grid-cols-2">{BREAKDOWN_REPORTS.map(breakdownPanel)}</div>
  </div>
}
