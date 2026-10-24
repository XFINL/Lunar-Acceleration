import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RoleType } from '@lunar/shared'
import { ApiError } from '@/api/client'
import { statisticsApi, type MetricReport, type TrafficStatistics } from '@/api/statistics'
import { domainApi } from '@/api/domain'
import { StatisticsPage } from '@/pages/user/StatisticsPage'
import { useAuthStore } from '@/stores/auth'

const clients: QueryClient[] = []
const response = (changes: Partial<TrafficStatistics> = {}): TrafficStatistics => ({
  granularity: 'hour', startTime: '2026-10-19T00:00:00.000Z', endTime: '2026-10-20T00:00:00.000Z', unit: 'bytes',
  source: 'persisted_hourly', coverage: 'observed_only', availability: 'available',
  series: [{ time: '2026-10-19T10:00:00.000Z', bytes: '1024' }], totalBytes: '1024', ...changes,
})
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}><StatisticsPage /></QueryClientProvider>)
}
beforeEach(() => {
  vi.restoreAllMocks()
  useAuthStore.setState({ user: { id: 'user-1', roleType: RoleType.USER, permissions: ['statistics:read', 'statistics:export'] } as never })
  vi.spyOn(statisticsApi, 'getTraffic').mockResolvedValue(response())
  vi.spyOn(statisticsApi, 'getReport').mockImplementation(async (report) => report === 'region' || report === 'isp' || report === 'status-code' || report === 'top-url' || report === 'top-ip'
    ? { items: [] }
    : { granularity: 'hour', startTime: '2026-10-19T00:00:00.000Z', endTime: '2026-10-20T00:00:00.000Z', unit: 'requests', series: [], total: '0' } as MetricReport)
  vi.spyOn(statisticsApi, 'exportCsv').mockResolvedValue(new Blob(['csv']))
  vi.spyOn(domainApi, 'list').mockResolvedValue({ list: [{ id: 'domain-1', domain: 'example.com' } as never], pagination: { page: 1, pageSize: 100, total: 1 } })
})
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); useAuthStore.setState({ user: null }) })

describe('StatisticsPage', () => {
  it('shows loading then observed traffic data', async () => {
    let resolveTraffic!: (value: TrafficStatistics) => void
    vi.mocked(statisticsApi.getTraffic).mockImplementation(() => new Promise((resolve) => { resolveTraffic = resolve }))
    renderPage()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    resolveTraffic(response())
    expect(await screen.findAllByText('1,024 bytes')).toHaveLength(2)
  })
  it('distinguishes no_data from zero traffic and never fabricates a zero', async () => {
    vi.mocked(statisticsApi.getTraffic).mockResolvedValue(response({ availability: 'no_data', series: [], totalBytes: null }))
    renderPage()
    expect((await screen.findAllByText('No collection data has been received yet.')).length).toBeGreaterThan(0)
    expect(await screen.findByText('No data is not the same as zero traffic.')).toBeInTheDocument()
    expect(screen.queryByText('0 bytes')).not.toBeInTheDocument()
    expect(screen.getByText('bandwidth')).toBeInTheDocument()
    expect(screen.getByText('httpStatus')).toBeInTheDocument()
  })
  it('shows a collected zero value as zero and does not omit it', async () => {
    vi.mocked(statisticsApi.getTraffic).mockResolvedValue(response({ series: [{ time: '2026-10-19T10:00:00.000Z', bytes: '0' }], totalBytes: '0' }))
    renderPage()
    expect(await screen.findAllByText('0 bytes')).toHaveLength(2)
    expect(screen.getByText('2026-10-19T10:00:00.000Z')).toBeInTheDocument()
  })
  it('formats arbitrarily large byte counters exactly with BigInt', async () => {
    const big = '123456789012345678901234567890'
    vi.mocked(statisticsApi.getTraffic).mockResolvedValue(response({ series: [{ time: '2026-10-19T10:00:00Z', bytes: big }], totalBytes: big }))
    renderPage()
    expect(await screen.findAllByText('123,456,789,012,345,678,901,234,567,890 bytes')).toHaveLength(2)
  })
  it('does not invent missing intervals in the traffic table', async () => {
    vi.mocked(statisticsApi.getTraffic).mockResolvedValue(response({ series: [
      { time: '2026-10-19T10:00:00Z', bytes: '4' }, { time: '2026-10-19T12:00:00Z', bytes: '6' },
    ], totalBytes: '10' }))
    renderPage()
    await screen.findByText('10 bytes')
    expect(screen.getByText('2026-10-19T10:00:00.000Z')).toBeInTheDocument()
    expect(screen.getByText('2026-10-19T12:00:00.000Z')).toBeInTheDocument()
    expect(screen.queryByText('2026-10-19T11:00:00.000Z')).not.toBeInTheDocument()
  })
  it.each([400, 403, 500])('shows HTTP %i errors distinctly and retries', async (status) => {
    vi.mocked(statisticsApi.getTraffic).mockRejectedValue(new ApiError(status, `HTTP ${status}`))
    renderPage()
    expect((await screen.findAllByText(`HTTP ${status}`)).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('alert').some((element) => element.textContent?.includes(`HTTP ${status}`))).toBe(true)
    await userEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0])
    await waitFor(() => expect(statisticsApi.getTraffic).toHaveBeenCalledTimes(2))
  })
  it('filters by domain while using the verified default hour API contract', async () => {
    const user = userEvent.setup(); renderPage(); await screen.findAllByText('1,024 bytes')
    await user.click(screen.getByRole('combobox', { name: 'Domain' }))
    await user.click(await screen.findByRole('option', { name: 'example.com' }))
    await waitFor(() => expect(statisticsApi.getTraffic).toHaveBeenCalledWith({ domainId: 'domain-1', granularity: 'hour' }))
  })
  it('supports week grain through observed daily data and explicit custom UTC ranges', async () => {
    const user = userEvent.setup(); renderPage(); await screen.findAllByText('1,024 bytes')
    await user.click(screen.getByRole('combobox', { name: 'Time granularity' }))
    await user.click(await screen.findByRole('option', { name: 'Week' }))
    await waitFor(() => expect(statisticsApi.getReport).toHaveBeenCalledWith('traffic', expect.objectContaining({ granularity: 'week', startTime: expect.any(String), endTime: expect.any(String) })))
    await user.clear(screen.getByLabelText('Start (UTC ISO)')); await user.type(screen.getByLabelText('Start (UTC ISO)'), '2026-10-01T00:00:00Z')
    await user.clear(screen.getByLabelText('End (UTC ISO, exclusive)')); await user.type(screen.getByLabelText('End (UTC ISO, exclusive)'), '2026-10-08T00:00:00Z')
    await user.click(screen.getByRole('button', { name: 'Apply UTC range' }))
    await waitFor(() => expect(statisticsApi.getReport).toHaveBeenCalledWith('traffic', { domainId: undefined, granularity: 'week', startTime: '2026-10-01T00:00:00.000Z', endTime: '2026-10-08T00:00:00.000Z' }))
  })
  it('allows CSV only with statistics:export and exports exact observed rows', async () => {
    const create = vi.fn().mockReturnValue('blob:test'); const revoke = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderPage(); await screen.findAllByText('1,024 bytes')
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(statisticsApi.exportCsv).toHaveBeenCalledWith({ domainId: undefined, granularity: 'hour', report: 'traffic' }))
    expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce()
    useAuthStore.setState({ user: { id: 'user-1', roleType: RoleType.USER, permissions: ['statistics:read'] } as never })
    cleanup(); renderPage(); await screen.findAllByText('1,024 bytes')
    expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument()
    expect(screen.getByText('statistics:export permission is required to download CSV.')).toBeInTheDocument()
  })
  it('does not request data without statistics:read permission', () => {
    useAuthStore.setState({ user: { id: 'user-1', roleType: RoleType.USER, permissions: [] } as never })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('statistics:read')
    expect(statisticsApi.getTraffic).not.toHaveBeenCalled(); expect(domainApi.list).not.toHaveBeenCalled()
  })
})
