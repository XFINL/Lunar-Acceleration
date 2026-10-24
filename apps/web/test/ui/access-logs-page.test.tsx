import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RoleType } from '@lunar/shared'
import { ApiError } from '@/api/client'
import { logsApi } from '@/api/logs'
import { domainApi } from '@/api/domain'
import { AccessLogsPage } from '@/pages/user/AccessLogsPage'
import { useAuthStore } from '@/stores/auth'

const clients: QueryClient[] = []
const row = { id: 'log-1', domainId: 'domain-1', eventTime: '2026-10-20T10:00:00.000Z', statusCode: 200, ip: '203.0.113.7', url: '/index.html', userAgent: 'Test Agent', bytes: '0' }
const page = (items = [row], current = 1) => ({ list: items, page: current, pageSize: 21 })
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  sent: string[] = []
  closed = false
  constructor(readonly url: string) { FakeWebSocket.instances.push(this) }
  send(data: string) { this.sent.push(data) }
  close() { this.closed = true; this.readyState = FakeWebSocket.CLOSING; this.onclose?.(new CloseEvent('close')) }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(new Event('open')) }
  message(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent) }
  fail() { this.onerror?.(new Event('error')) }
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client)
  return render(<QueryClientProvider client={client}><AccessLogsPage /></QueryClientProvider>)
}
beforeEach(() => {
  vi.restoreAllMocks()
  FakeWebSocket.instances = []
  useAuthStore.setState({ accessToken: null, user: { id: 'user-1', roleType: RoleType.USER, permissions: ['log:read', 'log:export'] } as never })
  vi.spyOn(logsApi, 'listAccess').mockResolvedValue(page())
  vi.spyOn(logsApi, 'exportAccess').mockResolvedValue(new Blob(['csv'], { type: 'text/csv' }))
  vi.spyOn(domainApi, 'list').mockResolvedValue({ list: [{ id: 'domain-1', domain: 'example.com' } as never], pagination: { page: 1, pageSize: 100, total: 1 } })
})
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); useAuthStore.setState({ accessToken: null, user: null }); vi.unstubAllGlobals() })

describe('AccessLogsPage', () => {
  it('renders readable access event rows and filter controls', async () => {
    renderPage()
    expect(await screen.findByText('/index.html')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.7')).toBeInTheDocument()
    expect(screen.getByLabelText('HTTP status')).toBeInTheDocument()
    expect(screen.getByLabelText('User agent')).toBeInTheDocument()
  })
  it('applies domain, time, status, IP, URL and UA filters to the paged query', async () => {
    const user = userEvent.setup(); renderPage(); await screen.findByText('/index.html')
    await user.click(screen.getByRole('combobox', { name: 'Domain' }))
    await user.click(await screen.findByRole('option', { name: 'example.com' }))
    await user.type(screen.getByLabelText('Start (UTC ISO)'), '2026-10-01T00:00:00Z')
    await user.type(screen.getByLabelText('End (UTC ISO)'), '2026-10-02T00:00:00Z')
    await user.type(screen.getByLabelText('HTTP status'), '404')
    await user.type(screen.getByLabelText('IP address'), '203.0.113.7')
    await user.type(screen.getByLabelText('URL'), '/missing')
    await user.type(screen.getByLabelText('User agent'), 'Browser')
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(logsApi.listAccess).toHaveBeenLastCalledWith({
      domainId: 'domain-1', startTime: '2026-10-01T00:00:00Z', endTime: '2026-10-02T00:00:00Z', statusCode: '404', ip: '203.0.113.7', url: '/missing', userAgent: 'Browser', page: 1, pageSize: 21,
    }))
  })
  it('downloads server CSV for the applied filters with log:export permission', async () => {
    const create = vi.fn().mockReturnValue('blob:access-logs'); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderPage(); await screen.findByText('/index.html')
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() => expect(logsApi.exportAccess).toHaveBeenCalledWith({}))
    expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce()
  })
  it('paginates using server page metadata', async () => {
    vi.mocked(logsApi.listAccess).mockImplementation(async (query) => page(query.page === 1 ? Array.from({ length: 21 }, (_, n) => ({ ...row, id: `log-${n}` })) : [row], query.page))
    renderPage(); await screen.findAllByText('/index.html')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(logsApi.listAccess).toHaveBeenLastCalledWith({ page: 2, pageSize: 21 }))
  })
  it('hides protected content and makes no request without log:read', () => {
    useAuthStore.setState({ user: { id: 'user-1', roleType: RoleType.USER, permissions: [] } as never })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('log:read')
    expect(logsApi.listAccess).not.toHaveBeenCalled(); expect(domainApi.list).not.toHaveBeenCalled()
  })
  it('hides CSV export without log:export', async () => {
    useAuthStore.setState({ user: { id: 'user-1', roleType: RoleType.USER, permissions: ['log:read'] } as never })
    renderPage(); await screen.findByText('/index.html')
    expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument()
    expect(screen.getByText('log:export permission is required to download CSV.')).toBeInTheDocument()
    expect(logsApi.exportAccess).not.toHaveBeenCalled()
  })
  it('offers retry after a list error and retries the current query', async () => {
    vi.mocked(logsApi.listAccess).mockRejectedValueOnce(new ApiError(500, 'HTTP 500')).mockResolvedValue(page())
    renderPage()
    expect(await screen.findByText('HTTP 500')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(logsApi.listAccess).toHaveBeenCalledTimes(2))
  })
  it('connects only on Start, subscribes with the selected domain and supported filters, safely renders live logs, and closes on Stop', async () => {
    const token = 'private-jwt-token'
    useAuthStore.setState({ accessToken: token })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const user = userEvent.setup()
    const { container } = renderPage()
    await screen.findByText('/index.html')
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    await user.click(screen.getByRole('combobox', { name: 'Domain' }))
    await user.click(await screen.findByRole('option', { name: 'example.com' }))
    await user.type(screen.getByLabelText('HTTP status'), '404')
    await user.type(screen.getByLabelText('IP address'), '203.0.113.8')
    await user.type(screen.getByLabelText('URL'), '/live')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(FakeWebSocket.instances).toHaveLength(1)
    const socket = FakeWebSocket.instances[0]
    expect(socket.url).toBe(`ws://${window.location.host}/api/v1/user/logs/realtime?token=${encodeURIComponent(token)}`)
    expect(document.body).not.toHaveTextContent(token)
    expect(screen.getByText('Connecting…')).toBeInTheDocument()
    socket.open()
    expect(JSON.parse(socket.sent[0])).toEqual({ action: 'subscribe', domainId: 'domain-1', filters: { statusCode: [404], ip: '203.0.113.8', url: '/live' } })
    expect(await screen.findByText('Connected')).toBeInTheDocument()
    socket.message({ type: 'log', log: { domainId: 'domain-1', time: '2026-10-24T10:00:00Z', ip: '203.0.113.8', url: '<img src=x onerror=alert(1)>', status: 404, bytes: 12, userAgent: 'Safe text', region: 'Test region', isp: 'Test ISP' } })
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByText('Safe text')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(socket.closed).toBe(true)
    expect(await screen.findByText('Stopped')).toBeInTheDocument()
  })
  it('keeps at most 100 live logs and reports server and handshake errors without reconnecting', async () => {
    useAuthStore.setState({ accessToken: 'ws-token' })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const user = userEvent.setup()
    renderPage(); await screen.findByText('/index.html')
    await user.click(screen.getByRole('combobox', { name: 'Domain' }))
    await user.click(await screen.findByRole('option', { name: 'example.com' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    const socket = FakeWebSocket.instances[0]
    socket.open()
    for (let index = 0; index < 105; index += 1) socket.message({ type: 'log', log: { domainId: 'domain-1', time: `2026-10-24T10:00:${index}Z`, ip: '192.0.2.1', url: `/live-${index}`, status: 200, bytes: 1 } })
    expect(await screen.findByText('/live-104')).toBeInTheDocument()
    expect(screen.queryByText('/live-4')).not.toBeInTheDocument()
    socket.message({ type: 'error', code: 'SUBSCRIPTION_DENIED' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Realtime subscription failed (SUBSCRIPTION_DENIED).')
    expect(socket.closed).toBe(true)
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    const failedSocket = FakeWebSocket.instances[1]
    failedSocket.fail()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect to realtime logs.')
    expect(failedSocket.closed).toBe(true)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })
  it('closes the WebSocket when the page unmounts', async () => {
    useAuthStore.setState({ accessToken: 'ws-token' })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const user = userEvent.setup()
    const view = renderPage(); await screen.findByText('/index.html')
    await user.click(screen.getByRole('combobox', { name: 'Domain' }))
    await user.click(await screen.findByRole('option', { name: 'example.com' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    const socket = FakeWebSocket.instances[0]
    view.unmount()
    expect(socket.closed).toBe(true)
  })
})
