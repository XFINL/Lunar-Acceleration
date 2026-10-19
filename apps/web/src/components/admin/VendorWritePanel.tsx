import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { vendorWriteApi, type VendorWriteAction, type VendorWriteJob } from '@/api/vendor-write'
import { useAuthStore, selectHasPermission } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmAction } from '@/components/common/ConfirmAction'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectRoot as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Pagination } from '@/components/common/Pagination'
import { Loading } from '@/components/common/Loading'

interface VendorWritePanelProps {
  accountId: string
  accountName: string
}

const PAGE_SIZE = 10
const isActive = (status: string) => status === 'queued' || status === 'running' || status === 'retry_wait'
const isSafeToRetry = (job: VendorWriteJob) =>
  job.status === 'failed' && job.retryable === true
const errorText = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback
const dateText = (value?: string | null) => value ? new Date(value).toLocaleString() : '—'

export function VendorWritePanel({ accountId, accountName }: VendorWritePanelProps) {
  const { t } = useTranslation()
  const tx = (key: string, fallback: string) => t(`m4.vendorWrite.${key}`, { defaultValue: fallback })
  const canDeploy = useAuthStore(selectHasPermission('vendor:deploy'))
  const queryClient = useQueryClient()
  const [domainId, setDomainId] = useState('')
  const [action, setAction] = useState<VendorWriteAction>('register')
  const [page, setPage] = useState(1)
  const idempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null)
  const capabilitiesQuery = useQuery({
    queryKey: ['admin', 'vendor-write-capabilities'],
    queryFn: vendorWriteApi.capabilities,
    staleTime: 15_000,
  })
  const jobsQuery = useQuery({
    queryKey: ['admin', 'vendor-write-jobs', accountId, page],
    queryFn: () => vendorWriteApi.listAccountJobs(accountId, { page, pageSize: PAGE_SIZE }),
    enabled: Boolean(accountId),
    refetchInterval: (query) => query.state.data?.list.some((job) => isActive(job.status)) ? 5_000 : false,
  })
  const refreshJobs = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'vendor-write-jobs', accountId] })
  const refreshAll = () => { refreshJobs(); void capabilitiesQuery.refetch() }
  const createJob = useMutation({
    mutationFn: (payload: { action: VendorWriteAction; domainId: string; idempotencyKey: string }) =>
      vendorWriteApi.createAccountJob(accountId, payload),
    onSuccess: () => {
      idempotencyRef.current = null
      setDomainId('')
      toast.success(tx('created', '安全写入任务已加入队列'))
      refreshJobs()
    },
    onError: (error) => toast.error(errorText(error, t('common.failed'))),
  })
  const retryJob = useMutation({
    mutationFn: (jobId: string) => vendorWriteApi.retryJob(jobId),
    onSuccess: () => { toast.success(tx('retried', '重试任务已提交')); refreshJobs() },
    onError: (error) => toast.error(errorText(error, t('common.failed'))),
  })
  const capabilities = capabilitiesQuery.data
  const capabilityReady = Boolean(capabilities && !capabilitiesQuery.isError)
  const writesEnabled = capabilities?.writesEnabled === true && capabilities.workerEnabled === true
  const normalizedDomainId = domainId.trim()
  const validDomainId = /^[1-9][0-9]{0,19}$/.test(normalizedDomainId) && BigInt(normalizedDomainId) <= 18446744073709551615n
  const submitDisabled = !canDeploy || !capabilityReady || !writesEnabled || !validDomainId || createJob.isPending
  const handlePayloadChange = (update: () => void) => {
    idempotencyRef.current = null
    update()
  }
  const submitConfirmed = () => {
    const normalizedDomainId = domainId.trim()
    const fingerprint = `${action}\u0000${normalizedDomainId}`
    if (!idempotencyRef.current || idempotencyRef.current.fingerprint !== fingerprint) {
      idempotencyRef.current = { fingerprint, key: crypto.randomUUID() }
    }
    createJob.mutate({ action, domainId: normalizedDomainId, idempotencyKey: idempotencyRef.current.key })
  }
  useEffect(() => { setPage(1); idempotencyRef.current = null }, [accountId])
  const jobs = jobsQuery.data?.list ?? []
  const statusLabel = (status: string) => {
    if (status === 'queued') return tx('queued', '排队中')
    if (status === 'running') return tx('running', '运行中')
    if (status === 'retry_wait') return tx('retryWait', '等待安全重试')
    if (status === 'succeeded' || status === 'success' || status === 'completed') return tx('succeeded', '成功')
    if (status === 'failed') return tx('failed', '失败')
    if (status === 'needs_review') return tx('needsReview', '待人工确认')
    return status
  }
  const actionLabel = (item: VendorWriteAction) => item === 'register' ? tx('register', '云端基础注册') : tx('delete', '云端删除')

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-0">
        <div>
          <CardTitle>{tx('title', '云端受控注册 / 删除')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{tx('account', '当前账号：')} {accountName}</p>
        </div>
        <Button type="button" variant="outline" disabled={jobsQuery.isFetching} onClick={refreshAll}>
          {jobsQuery.isFetching ? t('common.loading') : t('common.refresh')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="notice text-sm">
          <p className="font-medium">{tx('safetyTitle', '受控写入说明')}</p>
          <p className="mt-1 text-muted-foreground">{tx('safetyWarning', '提交会修改远端云端资源。注册仅表示云端基础注册任务，不代表缓存、回源或 TLS 已完整上线；删除仅允许删除由本面板创建且经后端验证的资源。')}</p>
          {!canDeploy && <p className="mt-2 text-destructive">{tx('permissionOff', '缺少 vendor:deploy 权限，已禁用提交。')}</p>}
          {capabilitiesQuery.isLoading && <p className="mt-2 text-muted-foreground">{tx('checking', '正在检查后端写入开关…')}</p>}
          {capabilitiesQuery.isError && <p className="mt-2 text-destructive">{errorText(capabilitiesQuery.error, t('common.failed'))} · {tx('capabilityUnavailable', '无法确认后端写入能力，已禁用提交。')}</p>}
          {capabilityReady && !capabilities?.writesEnabled && <p className="mt-2 text-destructive">{tx('writesOff', '后端全局写入开关未启用（默认关闭），已禁用提交。')}</p>}
          {capabilityReady && capabilities?.writesEnabled && !capabilities.workerEnabled && <p className="mt-2 text-destructive">{tx('workerOff', '后端写入工作器未启用，已禁用提交。')}</p>}
        </div>

        <div className="form-grid">
          <div className="field">
            <Label htmlFor="vendor-write-domain-id">{tx('domainIdLabel', '域名记录 ID（domainId）')}</Label>
            <Input id="vendor-write-domain-id" inputMode="numeric" autoComplete="off" value={domainId} onChange={(event) => handlePayloadChange(() => setDomainId(event.target.value))} placeholder={tx('domainIdPlaceholder', '输入系统中的 domainId，不是域名字符串')} disabled={createJob.isPending} />
            <p className="text-xs text-muted-foreground">{tx('domainIdHint', '请使用本系统域名记录的 ID；不要在此输入域名字符串。')}</p>
          </div>
          <div className="field">
            <Label htmlFor="vendor-write-action">{tx('actionLabel', '云端动作')}</Label>
            <Select value={action} onValueChange={(value) => handlePayloadChange(() => setAction(value as VendorWriteAction))} disabled={createJob.isPending}>
              <SelectTrigger id="vendor-write-action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="register">{actionLabel('register')}</SelectItem>
                <SelectItem value="delete">{actionLabel('delete')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <ConfirmAction
          title={tx('confirmTitle', '确认提交云端写入任务？')}
          description={`${tx('confirmAccount', '账号：')} ${accountName}\n${tx('confirmDomainId', 'domainId：')} ${domainId.trim() || '—'}\n${tx('confirmAction', '动作：')} ${actionLabel(action)}\n\n${tx('confirmWarning', '此操作会修改远端资源。注册不代表缓存、回源或 TLS 完整上线；删除仅能针对本面板创建且由后端确认的资源。')}`}
          onConfirm={submitConfirmed}
        >
          <Button type="button" disabled={submitDisabled}>{createJob.isPending ? t('common.loading') : tx('submit', '提交受控任务')}</Button>
        </ConfirmAction>
        {!createJob.isPending && createJob.isError && <p className="text-sm text-destructive">{errorText(createJob.error, t('common.failed'))}</p>}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{tx('jobsTitle', '任务队列')}</h3>
            <p className="text-xs text-muted-foreground">{tx('pollingHint', '当前页存在排队、运行或等待重试任务时，每 5 秒自动刷新。')}</p>
          </div>
          {jobsQuery.isLoading ? <Loading /> : jobsQuery.isError ? (
            <div className="text-sm text-destructive">{errorText(jobsQuery.error, t('common.failed'))}</div>
          ) : jobs.length === 0 ? (
            <div className="py-4 text-sm text-muted-foreground">{t('common.noData')}</div>
          ) : (
            <>
              <div className="min-w-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{tx('jobAction', '动作')}</TableHead><TableHead>domainId / {tx('receipt', '远端回执')}</TableHead><TableHead>{tx('status', '状态')}</TableHead><TableHead>{tx('attempts', '尝试次数')}</TableHead><TableHead>{tx('message', '任务消息')}</TableHead><TableHead>{tx('updatedAt', '更新时间')}</TableHead><TableHead>{tx('operations', '操作')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>{jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>{actionLabel(job.action)}</TableCell>
                      <TableCell className="font-mono text-xs">{job.domainId}{job.externalId && <span className="mt-1 block max-w-48 break-all text-muted-foreground">{job.externalId}</span>}</TableCell>
                      <TableCell><Badge variant={job.status === 'failed' || job.status === 'needs_review' ? 'destructive' : job.status === 'succeeded' || job.status === 'success' || job.status === 'completed' ? 'default' : 'secondary'}>{statusLabel(job.status)}</Badge></TableCell>
                      <TableCell>{job.attempts}</TableCell>
                      <TableCell className="max-w-xs whitespace-normal">{job.message || '—'}{job.errorCode && <span className="block text-xs text-muted-foreground">{job.errorCode}</span>}</TableCell>
                      <TableCell>{dateText(job.updatedAt)}</TableCell>
                      <TableCell>
                        {isSafeToRetry(job) ? <ConfirmAction title={tx('retryTitle', '确认重试安全失败任务？')} description={`${tx('retryJob', '任务 ID：')} ${job.id}\n${tx('confirmAccount', '账号：')} ${accountName}\n${tx('retryNotice', '只会重试后端确认未执行远端写入的任务，并重新校验当前域名配置与凭据；不确定的结果不能重试。')}`} onConfirm={() => retryJob.mutate(job.id)}>
                          <Button type="button" size="sm" variant="outline" disabled={!canDeploy || !capabilityReady || !writesEnabled || retryJob.isPending}>{tx('retry', '重试')}</Button>
                        </ConfirmAction> : job.status === 'failed' ? <span className="text-xs text-muted-foreground">{tx('retryNotSafe', '失败原因未确认安全，不提供重试')}</span> : job.status === 'needs_review' ? <span className="text-xs text-muted-foreground">{tx('manualReview', '需人工确认')}</span> : '—'}
                      </TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </div>
              <Pagination page={jobsQuery.data!.pagination.page} pageSize={jobsQuery.data!.pagination.pageSize} total={jobsQuery.data!.pagination.total} onPageChange={setPage} />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
