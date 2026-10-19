import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RoleType } from '@lunar/shared'
import { VendorWritePanel } from '@/components/admin/VendorWritePanel'
import { vendorWriteApi, type VendorWriteJob } from '@/api/vendor-write'
import { useAuthStore } from '@/stores/auth'

vi.mock('@/api/vendor-write', () => ({ vendorWriteApi: {
  capabilities: vi.fn(), listAccountJobs: vi.fn(), createAccountJob: vi.fn(), retryJob: vi.fn(),
} }))

const clients: QueryClient[] = []
function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}><VendorWritePanel accountId="9" accountName="Test account" /></QueryClientProvider>)
}
const emptyPage = { list: [], pagination: { page: 1, pageSize: 10, total: 0 } }
const job = (changes: Partial<VendorWriteJob> = {}): VendorWriteJob => ({
  id: '7', vendorAccountId: '9', domainId: '42', action: 'register', status: 'queued', attempts: 0,
  message: 'Queued', createdAt: '2026-10-19T10:00:00Z', updatedAt: '2026-10-19T10:00:00Z', ...changes,
})
beforeEach(() => {
  vi.resetAllMocks()
  useAuthStore.setState({ user: { roleType: RoleType.SUPER_ADMIN, permissions: [] } as never })
  vi.mocked(vendorWriteApi.capabilities).mockResolvedValue({ writesEnabled: true, workerEnabled: true })
  vi.mocked(vendorWriteApi.listAccountJobs).mockResolvedValue(emptyPage)
  vi.mocked(vendorWriteApi.createAccountJob).mockResolvedValue(job())
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); useAuthStore.setState({ user: null }) })

describe('Controlled cloud write panel', () => {
  it('fails closed when cloud writes are disabled, even for a super admin', async () => {
    vi.mocked(vendorWriteApi.capabilities).mockResolvedValue({ writesEnabled: false, workerEnabled: false })
    renderPanel()
    await screen.findByText(/后端全局写入开关未启用/)
    await userEvent.type(screen.getByLabelText('域名记录 ID（domainId）'), '42')
    expect(screen.getByRole('button', { name: '提交受控任务' })).toBeDisabled()
    expect(vendorWriteApi.createAccountJob).not.toHaveBeenCalled()
  })

  it('does not treat vendor:read as permission to mutate cloud resources', async () => {
    useAuthStore.setState({ user: { roleType: RoleType.ADMIN, permissions: ['vendor:read'] } as never })
    renderPanel()
    await screen.findByText(/缺少 vendor:deploy 权限/)
    await userEvent.type(screen.getByLabelText('域名记录 ID（domainId）'), '42')
    expect(screen.getByRole('button', { name: '提交受控任务' })).toBeDisabled()
    expect(vendorWriteApi.createAccountJob).not.toHaveBeenCalled()
  })

  it('requires a valid domain record ID and explicit confirmation before creating a job', async () => {
    const user = userEvent.setup()
    renderPanel()
    const field = screen.getByLabelText('域名记录 ID（domainId）')
    await user.type(field, '18446744073709551616')
    expect(screen.getByRole('button', { name: '提交受控任务' })).toBeDisabled()
    await user.clear(field)
    await user.type(field, '42')
    await waitFor(() => expect(screen.getByRole('button', { name: '提交受控任务' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: '提交受控任务' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Test account')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('42')
    expect(vendorWriteApi.createAccountJob).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm', exact: true }))
    await waitFor(() => expect(vendorWriteApi.createAccountJob).toHaveBeenCalledTimes(1))
    expect(vendorWriteApi.createAccountJob).toHaveBeenCalledWith('9', expect.objectContaining({ action: 'register', domainId: '42', idempotencyKey: expect.any(String) }))
  })

  it('keeps deployment disabled unless the backend explicitly advertises it', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByRole('option', { name: '設定配信と検証' })).toHaveAttribute('aria-disabled', 'true')
    expect(vendorWriteApi.createAccountJob).not.toHaveBeenCalled()
  })

  it('confirms deployment separately and sends only an ID, action and idempotency key', async () => {
    vi.mocked(vendorWriteApi.capabilities).mockResolvedValue({ writesEnabled: true, workerEnabled: true, supportedActions: ['register', 'deploy', 'delete'] })
    const user = userEvent.setup()
    renderPanel()
    await user.type(screen.getByLabelText('域名记录 ID（domainId）'), '42')
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: '設定配信と検証' }))
    await user.click(screen.getByRole('button', { name: '提交受控任务' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('設定配信と検証')
    expect(dialog).toHaveTextContent('実トラフィック・DNS・TLS')
    expect(vendorWriteApi.createAccountJob).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Confirm', exact: true }))
    await waitFor(() => expect(vendorWriteApi.createAccountJob).toHaveBeenCalledTimes(1))
    const payload = vi.mocked(vendorWriteApi.createAccountJob).mock.calls[0][1]
    expect(payload).toEqual({ action: 'deploy', domainId: '42', idempotencyKey: expect.any(String) })
  })

  it('shows the external receipt without offering retries for uncertain cloud outcomes', async () => {
    vi.mocked(vendorWriteApi.listAccountJobs).mockResolvedValue({ ...emptyPage, list: [job({ status: 'needs_review', externalId: 'remote-receipt-17', errorCode: 'OUTCOME_UNKNOWN' })] })
    renderPanel()
    await screen.findByText('待人工确认')
    expect(screen.getByText('remote-receipt-17')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })
})

it.each([true, false, undefined])('uses the backend retryable projection (%s), not a duplicated client-side error whitelist', async retryable => {
  vi.mocked(vendorWriteApi.listAccountJobs).mockResolvedValue({ ...emptyPage, list: [job({ status: 'failed', errorCode: 'PRECONDITION_FAILED', retryable })] })
  renderPanel()
  await screen.findByText('失败')
  if (retryable === true) {
    await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeEnabled())
  } else {
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  }
})
