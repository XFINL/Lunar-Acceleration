import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RoleType } from '@lunar/shared'
import { ApiError } from '@/api/client'
import { statisticsApi, type TrafficStatistics } from '@/api/statistics'
import { domainApi } from '@/api/domain'
import { StatisticsPage } from '@/pages/user/StatisticsPage'
import { useAuthStore } from '@/stores/auth'

const clients: QueryClient[] = []
const response = (changes: Partial<TrafficStatistics> = {}): TrafficStatistics => ({
  granularity: 'hour',
  startTime: '2026-10-19T00:00:00.000Z',
  endTime: '2026-10-20T00:00:00.000Z',
  unit: 'bytes',
  source: 'persisted_hourly',
  coverage: 'observed_only',
  availability: 'available',
  series: [{ time: '2026-10-19T10:00:00.000Z', bytes: '1024' }],
  totalBytes: '1024',
  ...changes,
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}><StatisticsPage /></QueryClientProvider>)
}

beforeEach(() => {
  vi.restoreAllMocks()
  useAuthStore.setState({ user: { id: 'user-1', roleType: RoleType.USER, permissions: ['statistics:read'] } as never })
  vi.spyOn(statisticsApi, 'getTraffic').mockResolvedValue(response())
  vi.spyOn(domainApi, 'list').mockResolvedValue({ list: [{ id: 'domain-1', domain: 'example.com' } as never], pagination: { page: 1, pageSize: 100, total: 1 } })
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.setState({ user: null })
})

describe('Traffic statistics page', () => {
  it('shows a loading state while the traffic request is pending', async () => {
    let resolveTraffic!: (value: TrafficStatistics) => void
    vi.mocked(statisticsApi.getTraffic).mockImplementation(() => new Promise((resolve) => { resolveTraffic = resolve }))
    renderPage()
    expect(await screen.findByText('Loading traffic statistics…')).toBeInTheDocument()
    resolveTraffic(response())
    await screen.findAllByText('1,024 bytes')
  })

  it('explains no_data as missing collection data, not zero traffic', async () => {
    vi.mocked(statisticsApi.getTraffic).mockResolvedValue(response({ availability: 'no_data', series: [], totalBytes: null }))
    renderPage()
    expect(await screen.findByText('No collection data has been received yet.')).toBeInTheDocument()
    expect(screen.getByText('No data is not the same as zero traffic.')).toBeInTheDocument()
    expect(screen.queryByText('Total traffic')).not.toBeInTheDocument()
    expect(screen.queryByText('0 bytes')).not.toBeInTheDocument()
  })

  it('shows a real observed zero as zero bytes', async () => {
    vi.mocked(statisticsApi.getTraffic).mockResolvedValue(response({ series: [{ time: '2026-10-19T10:00:00.000Z', bytes: '0' }], totalBytes: '0' }))
    renderPage()
    expect(await screen.findAllByText('0 bytes')).toHaveLength(2)
    expect(screen.getByText('2026-10-19T10:00:00.000Z')).toBeInTheDocument()
    expect(screen.getByText('Time (UTC)')).toBeInTheDocument()
  })

  it('formats very large decimal counters without losing integer precision', async () => {
    const big = '123456789012345678901234567890'
    vi.mocked(statisticsApi.getTraffic).mockResolvedValue(response({ series: [{ time: '2026-10-19T10:00:00.000Z', bytes: big }], totalBytes: big }))
    renderPage()
    expect(await screen.findAllByText('123,456,789,012,345,678,901,234,567,890 bytes')).toHaveLength(2)
  })

  it.each([400, 403, 500])('shows HTTP %i as an error distinct from no_data and offers a retry', async (status) => {
    const message = `HTTP ${status}`
    vi.mocked(statisticsApi.getTraffic).mockRejectedValue(new ApiError(status, message))
    renderPage()
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText('No collection data has been received yet.')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(statisticsApi.getTraffic).toHaveBeenCalledTimes(2))
  })

  it('filters by domain and omits explicit start/end times for the default window', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('1,024 bytes')
    await user.click(screen.getByRole('combobox', { name: 'Domain' }))
    await user.click(await screen.findByRole('option', { name: 'example.com' }))
    await waitFor(() => expect(statisticsApi.getTraffic).toHaveBeenCalledWith({ domainId: 'domain-1', granularity: 'hour' }))
    const params = vi.mocked(statisticsApi.getTraffic).mock.calls.at(-1)?.[0]
    expect(params).not.toHaveProperty('startTime')
    expect(params).not.toHaveProperty('endTime')
  })

  it('does not request domains or statistics without statistics:read permission', () => {
    useAuthStore.setState({ user: { id: 'user-1', roleType: RoleType.USER, permissions: [] } as never })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('statistics:read')
    expect(statisticsApi.getTraffic).not.toHaveBeenCalled()
    expect(domainApi.list).not.toHaveBeenCalled()
  })

  it('uses a user-scoped query key for traffic requests', async () => {
    renderPage()
    await screen.findAllByText('1,024 bytes')
    // Query client cache keys include the authenticated user ID to prevent cross-user tenant data reuse.
    // Query key包含登入者ID，避免不同租戶共用快取。
    const queryKey = clients[0].getQueryCache().findAll().find((query) => query.queryKey.includes('traffic'))?.queryKey
    expect(queryKey).toEqual(['user', 'user-1', 'statistics', 'traffic', null, 'hour'])
  })
})
