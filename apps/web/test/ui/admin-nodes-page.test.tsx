import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RoleType } from '@lunar/shared'
import { ApiError } from '@/api/client'
import { adminNodeApi, type NodeRecord } from '@/api/nodes'
import { AdminNodesPage } from '@/pages/admin/AdminNodesPage'
import { useAuthStore } from '@/stores/auth'

const clients: QueryClient[] = []
const node: NodeRecord = {
  id: 'node-1', name: 'Edge Tokyo', ip: '203.0.113.10', port: 443,
  region: 'Tokyo', status: 1, lastHeartbeat: '2026-10-24T04:00:00.000Z',
}
const secret = '<img src=x onerror=alert(1)>'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}><AdminNodesPage /></QueryClientProvider>)
}

beforeEach(() => {
  vi.restoreAllMocks()
  useAuthStore.setState({ user: { id: 'admin-1', roleType: RoleType.ADMIN, permissions: ['node:read', 'node:create', 'node:update'] } as never })
  vi.spyOn(adminNodeApi, 'list').mockResolvedValue({ list: [node] })
  vi.spyOn(adminNodeApi, 'create').mockResolvedValue({ ...node, token: secret })
  vi.spyOn(adminNodeApi, 'rotateToken').mockResolvedValue({ token: 'rotated-once-token' })
  vi.spyOn(adminNodeApi, 'metrics').mockResolvedValue([{ statTime: '2026-10-24T04:00:00.000Z', cpu: 21, mem: 43, disk: 31, bandwidthIn: '1200', bandwidthOut: '900', connections: 7, qps: 567, cacheHitRate: 99.5 }])
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.setState({ accessToken: null, user: null })
  Reflect.deleteProperty(window.navigator, 'clipboard')
})

describe('AdminNodesPage', () => {
  it('does not make any API request when the user has no node permission', () => {
    useAuthStore.setState({ user: { id: 'admin-1', roleType: RoleType.ADMIN, permissions: [] } as never })
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('m6Nodes.permissionDenied')
    expect(adminNodeApi.list).not.toHaveBeenCalled()
    expect(adminNodeApi.create).not.toHaveBeenCalled()
    expect(adminNodeApi.rotateToken).not.toHaveBeenCalled()
    expect(adminNodeApi.metrics).not.toHaveBeenCalled()
  })

  it('shows loading while the node list is pending', () => {
    vi.mocked(adminNodeApi.list).mockImplementation(() => new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders node identity, region, status, and last heartbeat without any token', async () => {
    renderPage()
    expect(await screen.findByText('Edge Tokyo')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.10:443')).toBeInTheDocument()
    expect(screen.getByText('Tokyo')).toBeInTheDocument()
    expect(screen.getByText('m6Nodes.online')).toBeInTheDocument()
    expect(screen.queryByText(secret)).not.toBeInTheDocument()
    expect(adminNodeApi.list).toHaveBeenCalledOnce()
  })

  it('shows a useful empty state when the registry has no nodes', async () => {
    vi.mocked(adminNodeApi.list).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('m6Nodes.emptyTitle')).toBeInTheDocument()
  })

  it('reports list errors and retries on demand', async () => {
    vi.mocked(adminNodeApi.list).mockRejectedValueOnce(new ApiError(500, 'Node service unavailable')).mockResolvedValue({ list: [node] })
    renderPage()
    expect(await screen.findByText('Node service unavailable')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'm6Nodes.retry' }))
    expect(await screen.findByText('Edge Tokyo')).toBeInTheDocument()
    await waitFor(() => expect(adminNodeApi.list).toHaveBeenCalledTimes(2))
  })

  it('creates a node, shows the one-time token as safe text, and only copies after an explicit click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { container } = renderPage()
    await screen.findByText('Edge Tokyo')
    await user.type(screen.getByLabelText('m6Nodes.name'), 'New Edge')
    await user.type(screen.getByLabelText('m6Nodes.ip'), '198.51.100.42')
    await user.clear(screen.getByLabelText('m6Nodes.port'))
    await user.type(screen.getByLabelText('m6Nodes.port'), '8443')
    await user.type(screen.getByLabelText('m6Nodes.region'), 'Frankfurt')
    await user.type(screen.getByLabelText('m6Nodes.isp'), 'Example ISP')
    await user.type(screen.getByLabelText('m6Nodes.nodeGroupId'), 'group-7')
    await user.clear(screen.getByLabelText('m6Nodes.weight'))
    await user.type(screen.getByLabelText('m6Nodes.weight'), '3')
    await user.type(screen.getByLabelText('m6Nodes.bandwidth'), '2500')
    await user.click(screen.getByRole('button', { name: 'm6Nodes.createNode' }))
    expect(await screen.findByTestId('node-token')).toHaveTextContent(secret)
    expect(screen.getByText('m6Nodes.secretWarning')).toBeInTheDocument()
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(writeText).not.toHaveBeenCalled()
    expect(adminNodeApi.create).toHaveBeenCalledWith({ name: 'New Edge', ip: '198.51.100.42', port: 8443, region: 'Frankfurt', isp: 'Example ISP', nodeGroupId: 'group-7', weight: 3, bandwidthMbps: 2500 })
    await user.click(screen.getByRole('button', { name: 'm6Nodes.copyToken' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(secret))
    expect(await screen.findByRole('status')).toHaveTextContent('m6Nodes.copied')
    await user.click(screen.getByRole('button', { name: 'm6Nodes.dismissSecret' }))
    expect(screen.queryByTestId('node-token')).not.toBeInTheDocument()
    expect(screen.queryByText(secret)).not.toBeInTheDocument()
  })

  it('rotates a node token only with node:update permission and reveals it once', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Edge Tokyo')
    await user.click(screen.getByRole('button', { name: 'm6Nodes.rotateToken' }))
    expect(await screen.findByTestId('node-token')).toHaveTextContent('rotated-once-token')
    expect(adminNodeApi.rotateToken).toHaveBeenCalledWith('node-1')
    expect(adminNodeApi.list).toHaveBeenCalledOnce()
    expect(adminNodeApi.metrics).not.toHaveBeenCalled()
  })

  it('fetches and displays recent metrics only after the monitor action', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Edge Tokyo')
    expect(adminNodeApi.metrics).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'm6Nodes.metrics' }))
    expect(await screen.findByText('21')).toBeInTheDocument()
    expect(screen.getByText('43')).toBeInTheDocument()
    expect(screen.getByText('31')).toBeInTheDocument()
    expect(screen.getByText('1200')).toBeInTheDocument()
    expect(screen.getByText('900')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('567')).toBeInTheDocument()
    expect(screen.getByText('99.5')).toBeInTheDocument()
    expect(adminNodeApi.metrics).toHaveBeenCalledWith('node-1')
  })

  it('uses node:read for monitoring and hides mutations without create/update permissions', async () => {
    useAuthStore.setState({ user: { id: 'admin-1', roleType: RoleType.ADMIN, permissions: ['node:read'] } as never })
    const user = userEvent.setup(); renderPage()
    await screen.findByText('Edge Tokyo')
    expect(screen.queryByRole('button', { name: 'm6Nodes.createNode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'm6Nodes.rotateToken' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'm6Nodes.metrics' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'm6Nodes.metrics' }))
    expect(await screen.findByText('21')).toBeInTheDocument()
    expect(adminNodeApi.create).not.toHaveBeenCalled()
    expect(adminNodeApi.rotateToken).not.toHaveBeenCalled()
    expect(adminNodeApi.metrics).toHaveBeenCalledWith('node-1')
  })
})
