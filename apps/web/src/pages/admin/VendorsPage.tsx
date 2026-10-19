import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { vendorApi, type Vendor, type VendorAccount, type VendorCode, type VendorLog, type VendorResource, type PageResult } from '@/api/vendor'
import { VendorWritePanel } from '@/components/admin/VendorWritePanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/common/ConfirmAction'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectRoot as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/common/EmptyState'
import { Loading } from '@/components/common/Loading'
import { PageHeader } from '@/components/common/PageHeader'
import { Pagination } from '@/components/common/Pagination'

const PAGE_SIZE = 10
const ZONE_ID_RE = /^[a-f0-9]{32}$/i
const tx = (t: (key: string, options?: Record<string, unknown>) => string, key: string, fallback: string) =>
  t(`m4.${key}`, { defaultValue: fallback })
const errorMessage = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback

interface VendorForm { name: string; code: VendorCode; description: string; status: number; sort: string }
interface AccountForm { name: string; accessKey: string; secretKey: string; zoneId: string; status: number }
const emptyVendor: VendorForm = { name: '', code: 'cloudflare', description: '', status: 1, sort: '0' }
const emptyAccount: AccountForm = { name: '', accessKey: '', secretKey: '', zoneId: '', status: 1 }

export function VendorsPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [vendorPage, setVendorPage] = useState(1)
  const [accountPage, setAccountPage] = useState(1)
  const [vendorDialog, setVendorDialog] = useState(false)
  const [accountDialog, setAccountDialog] = useState(false)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [editingAccount, setEditingAccount] = useState<VendorAccount | null>(null)
  const [vendorForm, setVendorForm] = useState<VendorForm>(emptyVendor)
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccount)
  const [vendorIdFilter, setVendorIdFilter] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [detailTab, setDetailTab] = useState<'logs' | 'resources'>('resources')
  const [detailPage, setDetailPage] = useState(1)
  const [formError, setFormError] = useState('')
  const m4 = (key: string, fallback: string) => tx(t, key, fallback)
  const commonError = t('common.failed')
  const vendorsQuery = useQuery({ queryKey: ['admin', 'vendors', vendorPage], queryFn: () => vendorApi.listVendors({ page: vendorPage, pageSize: PAGE_SIZE }) })
  const accountsQuery = useQuery({ queryKey: ['admin', 'vendor-accounts', vendorPage, accountPage, vendorIdFilter], queryFn: () => vendorApi.listAccounts({ page: accountPage, pageSize: PAGE_SIZE, vendorId: vendorIdFilter || undefined }) })
  const accounts = accountsQuery.data?.list ?? []
  const selectedAccount = useMemo(() => accounts.find((item) => item.id === selectedAccountId) ?? null, [accounts, selectedAccountId])
  const accountVendor = (account: VendorAccount | null) => account?.vendor ?? vendorsQuery.data?.list.find((item) => item.id === account?.vendorId)
  useEffect(() => {
    if (accounts.length && !accounts.some((item) => item.id === selectedAccountId)) setSelectedAccountId(accounts[0].id)
    if (!accounts.length) setSelectedAccountId('')
  }, [accounts, selectedAccountId])
  const detailsQuery = useQuery<PageResult<VendorLog> | PageResult<VendorResource>>({
    queryKey: ['admin', 'vendor-account', selectedAccountId, detailTab, detailPage],
    queryFn: () => detailTab === 'logs'
      ? vendorApi.accountLogs(selectedAccountId, { page: detailPage, pageSize: PAGE_SIZE })
      : vendorApi.accountResources(selectedAccountId, { page: detailPage, pageSize: PAGE_SIZE }),
    enabled: Boolean(selectedAccountId),
  })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'vendors'] })
    void qc.invalidateQueries({ queryKey: ['admin', 'vendor-accounts'] })
    void qc.invalidateQueries({ queryKey: ['admin', 'vendor-account'] })
  }
  const notifyError = (error: unknown) => toast.error(errorMessage(error, commonError))

  const createVendor = useMutation({ mutationFn: vendorApi.createVendor, onSuccess: () => { toast.success(t('common.success')); setVendorDialog(false); refresh() }, onError: notifyError })
  const updateVendor = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof vendorApi.updateVendor>[1] }) => vendorApi.updateVendor(id, payload), onSuccess: () => { toast.success(t('common.success')); setVendorDialog(false); refresh() }, onError: notifyError })
  const deleteVendor = useMutation({ mutationFn: vendorApi.deleteVendor, onSuccess: () => { toast.success(t('common.success')); refresh() }, onError: notifyError })
  const createAccount = useMutation({ mutationFn: vendorApi.createAccount, onSuccess: () => { toast.success(t('common.success')); setAccountDialog(false); setVendorIdFilter(''); setAccountPage(1); refresh() }, onError: notifyError })
  const updateAccount = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof vendorApi.updateAccount>[1] }) => vendorApi.updateAccount(id, payload), onSuccess: () => { toast.success(t('common.success')); setAccountDialog(false); refresh() }, onError: notifyError })
  const deleteAccount = useMutation({ mutationFn: vendorApi.deleteAccount, onSuccess: () => { toast.success(t('common.success')); refresh() }, onError: notifyError })
  const testAccount = useMutation({ mutationFn: vendorApi.testAccount, onSuccess: (result) => { toast.success(`${m4('connected', 'Connection successful')}: ${result.provider}${result.accountLabel ? ` · ${result.accountLabel}` : ''} · ${new Date(result.checkedAt).toLocaleString()}`) }, onError: notifyError })
  const syncAccount = useMutation({ mutationFn: vendorApi.syncAccount, onSuccess: (result) => { toast.success(`${m4('syncComplete', 'Read-only snapshot sync complete')}: ${result.synced} / ${result.total} · ${m4('ignored', 'ignored')} ${result.ignored}${result.message ? ` · ${result.message}` : ''}`); refresh() }, onError: notifyError })
  const busy = createVendor.isPending || updateVendor.isPending || createAccount.isPending || updateAccount.isPending

  const startVendorCreate = () => { setEditingVendor(null); setVendorForm(emptyVendor); setFormError(''); setVendorDialog(true) }
  const startVendorEdit = (vendor: Vendor) => { setEditingVendor(vendor); setVendorForm({ name: vendor.name, code: vendor.code, description: vendor.description ?? '', status: vendor.status, sort: String(vendor.sort ?? 0) }); setFormError(''); setVendorDialog(true) }
  const startAccountCreate = () => { setEditingAccount(null); setAccountForm(emptyAccount); setFormError(''); setAccountDialog(true) }
  const startAccountEdit = (account: VendorAccount) => { setEditingAccount(account); setAccountForm({ name: account.name, accessKey: '', secretKey: '', zoneId: account.config?.zoneId ?? '', status: account.status }); setFormError(''); setAccountDialog(true) }

  const submitVendor = (event: FormEvent) => {
    event.preventDefault(); setFormError('')
    if (!vendorForm.name.trim()) { setFormError(m4('requiredName', 'Name is required.')); return }
    const description = vendorForm.description.trim() || undefined
    if (editingVendor) updateVendor.mutate({ id: editingVendor.id, payload: { name: vendorForm.name.trim(), description, status: vendorForm.status, sort: Number(vendorForm.sort) || 0 } })
    else createVendor.mutate({ name: vendorForm.name.trim(), code: vendorForm.code, description, status: vendorForm.status, sort: Number(vendorForm.sort) || 0 })
  }
  const submitAccount = (event: FormEvent) => {
    event.preventDefault(); setFormError('')
    const vendor = vendorsQuery.data?.list.find((item) => item.id === vendorIdFilter)
    const activeVendor = editingAccount ? accountVendor(editingAccount) : vendor
    if (!accountForm.name.trim()) { setFormError(m4('requiredName', 'Name is required.')); return }
    if (!editingAccount && !vendorIdFilter) { setFormError(m4('chooseVendor', 'Choose a provider first.')); return }
    if (!editingAccount && !accountForm.accessKey.trim()) { setFormError(m4('accessKeyRequired', 'Access key is required.')); return }
    if (activeVendor?.code === 'ali' && !editingAccount && !accountForm.secretKey.trim()) { setFormError(m4('secretKeyRequired', 'Secret key is required for Aliyun.')); return }
    if (activeVendor?.code === 'cloudflare' && !accountForm.zoneId.trim()) { setFormError(m4('zoneIdInvalid', 'Zone ID must be 32 hexadecimal characters.')); return }
    if (activeVendor?.code === 'cloudflare' && !ZONE_ID_RE.test(accountForm.zoneId.trim())) { setFormError(m4('zoneIdInvalid', 'Zone ID must be 32 hexadecimal characters.')); return }
    const config = activeVendor?.code === 'cloudflare' && accountForm.zoneId.trim() ? { zoneId: accountForm.zoneId.trim() } : {}
    if (editingAccount) {
      const payload: Parameters<typeof vendorApi.updateAccount>[1] = { name: accountForm.name.trim(), status: accountForm.status }
      // Never send mask values or empty fields: an omitted key preserves the stored credential.
      if (accountForm.accessKey.trim()) payload.accessKey = accountForm.accessKey.trim()
      if (accountForm.secretKey.trim()) payload.secretKey = accountForm.secretKey.trim()
      if (activeVendor?.code === 'cloudflare') payload.config = config
      updateAccount.mutate({ id: editingAccount.id, payload })
    } else {
      createAccount.mutate({ vendorId: vendorIdFilter, name: accountForm.name.trim(), accessKey: accountForm.accessKey.trim(), ...(activeVendor?.code === 'ali' ? { secretKey: accountForm.secretKey.trim() } : {}), config, status: accountForm.status })
    }
  }

  const vendorPending = createVendor.isPending || updateVendor.isPending || deleteVendor.isPending
  const accountPending = createAccount.isPending || updateAccount.isPending || deleteAccount.isPending || testAccount.isPending || syncAccount.isPending
  const vendorTitle = (vendor: Vendor) => `${vendor.name} (${vendor.code})`
  const vendors = vendorsQuery.data?.list ?? []
  const selectedProvider = selectedAccount?.vendor?.name ?? vendors.find((v) => v.id === selectedAccount?.vendorId)?.name ?? '—'
  const detailData = detailsQuery.data as PageResult<VendorLog> | PageResult<VendorResource> | undefined
  const logData = detailData as PageResult<VendorLog> | undefined
  const resourceData = detailData as PageResult<VendorResource> | undefined

  return (
    <div className="page-stack">
      <PageHeader title={m4('title', 'Vendor & account management')} description={m4('description', 'Manage provider definitions and the credentials used for read-only domain inventory synchronization.')} actions={<Button onClick={startVendorCreate}>{m4('addVendor', 'Add provider')}</Button>} />
      <div className="notice text-sm text-muted-foreground">
        <strong>{m4('safetyTitle', 'Controlled vendor write milestone')}</strong>
        <p className="mt-1">{m4('safetyNotice', '只读同步 + 显式启用的受控注册/删除；不自动上线。远端 pending/online 状态不代表域名已在本面板完整上线。')}</p>
      </div>

      <section className="page-stack">
        <div className="section-heading"><h2 className="text-lg font-semibold">{m4('providers', 'Providers')}</h2><Button variant="outline" size="sm" disabled={vendorsQuery.isFetching} onClick={() => void vendorsQuery.refetch()}>{t('common.refresh')}</Button></div>
        <Card><CardContent className="p-0">
          {vendorsQuery.isLoading ? <Loading /> : vendorsQuery.isError ? <div className="p-4 text-sm text-destructive">{errorMessage(vendorsQuery.error, commonError)} <Button variant="outline" size="sm" onClick={() => void vendorsQuery.refetch()}>{t('common.refresh')}</Button></div> : !vendors.length ? <EmptyState title={t('common.noData')} /> : <>
            <Table><TableHeader><TableRow><TableHead>{m4('providerName', 'Provider')}</TableHead><TableHead>{m4('driver', 'Driver')}</TableHead><TableHead>{m4('descriptionField', 'Description')}</TableHead><TableHead>{t('common.status')}</TableHead><TableHead>{m4('sort', 'Sort')}</TableHead><TableHead className="text-right">{t('common.actions')}</TableHead></TableRow></TableHeader><TableBody>{vendors.map((vendor) => <TableRow key={vendor.id}><TableCell className="font-medium">{vendorTitle(vendor)}</TableCell><TableCell>{vendor.driver}</TableCell><TableCell className="max-w-xs truncate">{vendor.description || '—'}</TableCell><TableCell><Badge variant={vendor.status === 1 ? 'default' : 'secondary'}>{vendor.status === 1 ? t('common.enabled') : t('common.disabled')}</Badge></TableCell><TableCell className="numeric">{vendor.sort}</TableCell><TableCell><div className="data-actions"><Button size="sm" variant="outline" disabled={vendorPending} onClick={() => startVendorEdit(vendor)}>{t('common.edit')}</Button><ConfirmAction title={t('common.delete')} description={m4('deleteVendorConfirm', 'Delete this provider? The server may reject it if referenced by an account or package.')} onConfirm={() => deleteVendor.mutate(vendor.id)}><Button size="sm" variant="destructive" disabled={vendorPending}>{t('common.delete')}</Button></ConfirmAction></div></TableCell></TableRow>)}</TableBody></Table>
            <div className="px-4 pb-4"><Pagination page={vendorsQuery.data?.pagination.page ?? vendorPage} pageSize={vendorsQuery.data?.pagination.pageSize ?? PAGE_SIZE} total={vendorsQuery.data?.pagination.total ?? 0} onPageChange={setVendorPage} /></div>
          </>}
        </CardContent></Card>
      </section>

      <section className="page-stack">
        <div className="section-heading flex-wrap"><h2 className="text-lg font-semibold">{m4('accounts', 'Provider accounts')}</h2><div className="data-actions min-w-0"><Select value={vendorIdFilter || "__radix_select_empty__"} onValueChange={(e) => { setVendorIdFilter(e === "__radix_select_empty__" ? '' : e); setAccountPage(1); setSelectedAccountId('') }}><SelectTrigger id="vendorspage-select-1" className="w-52" aria-label={m4('providerName', 'Provider')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__radix_select_empty__">{m4('allProviders', 'All providers')}</SelectItem>{vendors.map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendorTitle(vendor)}</SelectItem>)}</SelectContent></Select><Button onClick={startAccountCreate}>{m4('addAccount', 'Add account')}</Button></div></div>
        <Card><CardContent className="p-0">
          {accountsQuery.isLoading ? <Loading /> : accountsQuery.isError ? <div className="p-4 text-sm text-destructive">{errorMessage(accountsQuery.error, commonError)} <Button variant="outline" size="sm" onClick={() => void accountsQuery.refetch()}>{t('common.refresh')}</Button></div> : !accounts.length ? <EmptyState title={t('common.noData')} /> : <>
            <Table><TableHeader><TableRow><TableHead>{m4('accountName', 'Account')}</TableHead><TableHead>{m4('providerName', 'Provider')}</TableHead><TableHead>{m4('accessKey', 'Access key')}</TableHead><TableHead>{m4('secretKey', 'Secret key')}</TableHead><TableHead>{t('common.status')}</TableHead><TableHead>{m4('lastSyncAt', 'Last sync')}</TableHead><TableHead className="text-right">{t('common.actions')}</TableHead></TableRow></TableHeader><TableBody>{accounts.map((account) => <TableRow key={account.id} className={account.id === selectedAccountId ? 'bg-muted/50' : ''}>
              <TableCell><button className="font-medium text-primary underline-offset-4 hover:underline" aria-label={`${m4('accountDetails', 'Selected account details')}: ${account.name}`} onClick={() => { setSelectedAccountId(account.id); setDetailPage(1) }}>{account.name}</button></TableCell><TableCell>{account.vendor?.name ?? vendors.find((v) => v.id === account.vendorId)?.name ?? account.vendorId}</TableCell><TableCell className="font-mono text-xs">{account.hasAccessKey ? (account.accessKey || '••••••••') : '—'}</TableCell><TableCell className="font-mono text-xs">{account.hasSecretKey ? (account.secretKey || '••••••••') : '—'}</TableCell><TableCell><Badge variant={account.status === 1 ? 'default' : 'secondary'}>{account.status === 1 ? t('common.enabled') : t('common.disabled')}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : '—'}</TableCell>
              <TableCell><div className="data-actions"><Button size="sm" variant="outline" disabled={accountPending} onClick={() => testAccount.mutate(account.id)}>{m4('test', 'Test')}</Button><Button size="sm" variant="outline" disabled={accountPending} onClick={() => { setSelectedAccountId(account.id); syncAccount.mutate(account.id) }}>{m4('sync', 'Sync')}</Button><Button size="sm" variant="outline" disabled={accountPending} onClick={() => startAccountEdit(account)}>{t('common.edit')}</Button><ConfirmAction title={t('common.delete')} description={m4('deleteAccountConfirm', 'Remove this account locally? This removes saved credentials and snapshots only; cloud resources will not be deleted.')} onConfirm={() => deleteAccount.mutate(account.id)}><Button size="sm" variant="destructive" disabled={accountPending}>{t('common.delete')}</Button></ConfirmAction></div></TableCell>
            </TableRow>)}</TableBody></Table>
            <div className="px-4 pb-4"><Pagination page={accountsQuery.data?.pagination.page ?? accountPage} pageSize={accountsQuery.data?.pagination.pageSize ?? PAGE_SIZE} total={accountsQuery.data?.pagination.total ?? 0} onPageChange={setAccountPage} /></div>
          </>}
        </CardContent></Card>
      </section>

      <section>
        <div className="section-heading flex-wrap"><div><h2 className="text-lg font-semibold">{m4('accountDetails', 'Selected account details')}</h2>{selectedAccount && <p className="text-sm text-muted-foreground">{selectedAccount.name} · {selectedProvider}</p>}</div><div className="data-actions"><Button variant={detailTab === 'resources' ? 'default' : 'outline'} disabled={!selectedAccount} onClick={() => { setDetailTab('resources'); setDetailPage(1) }}>{m4('snapshots', 'Domain snapshots')}</Button><Button variant={detailTab === 'logs' ? 'default' : 'outline'} disabled={!selectedAccount} onClick={() => { setDetailTab('logs'); setDetailPage(1) }}>{m4('logs', 'Logs')}</Button></div></div>
        <p className="notice text-sm text-muted-foreground">{m4('remoteStatusNote', 'Remote provider status is an observation only. A remote “pending” or “online” state must not be interpreted as local approval, activation, or deployment.')}</p>
        <Card><CardContent className="p-0">{!selectedAccount ? <EmptyState title={m4('selectAccount', 'Select an account to view logs or snapshots.')} /> : detailsQuery.isLoading ? <Loading /> : detailsQuery.isError ? <div className="p-4 text-sm text-destructive">{errorMessage(detailsQuery.error, commonError)} <Button size="sm" variant="outline" onClick={() => void detailsQuery.refetch()}>{t('common.refresh')}</Button></div> : detailTab === 'logs' ? (
          !logData?.list.length ? <EmptyState title={t('common.noData')} /> : <><Table><TableHeader><TableRow><TableHead>{m4('action', 'Action')}</TableHead><TableHead>{m4('result', 'Result')}</TableHead><TableHead>{m4('message', 'Message')}</TableHead><TableHead>{t('common.createdAt')}</TableHead></TableRow></TableHeader><TableBody>{logData.list.map((log) => <TableRow key={log.id}><TableCell>{log.action}</TableCell><TableCell><Badge variant={log.status === 1 ? 'default' : 'destructive'}>{log.status === 1 ? m4('success', 'Success') : m4('failure', 'Failure')}</Badge></TableCell><TableCell className="max-w-lg whitespace-normal">{log.message}</TableCell><TableCell>{new Date(log.createdAt).toLocaleString()}</TableCell></TableRow>)}</TableBody></Table><div className="px-4 pb-4"><Pagination page={logData.pagination.page} pageSize={logData.pagination.pageSize} total={logData.pagination.total} onPageChange={setDetailPage} /></div></>
        ) : (
          !resourceData?.list.length ? <EmptyState title={m4('noSnapshots', 'No domain snapshots yet. Run a read-only sync to discover matching local domains.')} /> : <><Table><TableHeader><TableRow><TableHead>{m4('localDomain', 'Local domain')}</TableHead><TableHead>{m4('remoteHostname', 'Remote hostname')}</TableHead><TableHead>{m4('cname', 'CNAME')}</TableHead><TableHead>{m4('providerStatus', 'Remote status (observation)')}</TableHead><TableHead>{m4('sslStatus', 'SSL status')}</TableHead><TableHead>{m4('syncedAt', 'Observed at')}</TableHead></TableRow></TableHeader><TableBody>{resourceData.list.map((resource) => <TableRow key={resource.id}><TableCell>{resource.domain?.domain ?? resource.domainId}</TableCell><TableCell>{resource.resourceData?.hostname || '—'}</TableCell><TableCell className="font-mono text-xs">{resource.resourceData?.cname || '—'}</TableCell><TableCell>{resource.resourceData?.providerStatus || '—'} <span className="text-xs text-muted-foreground">({m4('observedOnly', 'observed only')})</span></TableCell><TableCell>{resource.resourceData?.sslStatus || '—'}</TableCell><TableCell>{resource.syncedAt ? new Date(resource.syncedAt).toLocaleString() : '—'}</TableCell></TableRow>)}</TableBody></Table><div className="px-4 pb-4"><Pagination page={resourceData.pagination.page} pageSize={resourceData.pagination.pageSize} total={resourceData.pagination.total} onPageChange={setDetailPage} /></div></>
        )}</CardContent></Card>
      </section>

      {selectedAccount && <VendorWritePanel accountId={selectedAccount.id} accountName={selectedAccount.name} />}

      <Dialog open={vendorDialog} onOpenChange={(open) => { if (!open && !vendorPending) setVendorDialog(false) }}><DialogContent><DialogHeader><DialogTitle>{editingVendor ? m4('editProvider', 'Edit provider') : m4('addVendor', 'Add provider')}</DialogTitle></DialogHeader><form onSubmit={submitVendor} className="space-y-4">
        <div className="form-field"><Label htmlFor="vendor-name">{m4('providerName', 'Provider')}</Label><Input id="vendor-name" value={vendorForm.name} onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })} required disabled={busy} /></div>
        <div className="form-field"><Label htmlFor="vendors-provider-code">{m4('providerCode', 'Provider code')}</Label><Select disabled={Boolean(editingVendor) || busy} value={vendorForm.code} onValueChange={(e) => setVendorForm({ ...vendorForm, code: e as VendorCode })}><SelectTrigger id="vendors-provider-code"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cloudflare">Cloudflare</SelectItem><SelectItem value="ali">Aliyun</SelectItem></SelectContent></Select>{editingVendor && <p className="text-xs text-muted-foreground">{m4('codeImmutable', 'Provider code cannot be changed after creation.')}</p>}</div>
        <div className="form-field"><Label htmlFor="vendor-field-1">{m4('descriptionField', 'Description')}</Label><Input id="vendor-field-1" value={vendorForm.description} onChange={(e) => setVendorForm({ ...vendorForm, description: e.target.value })} disabled={busy} /></div>
        <div className="form-grid"><div className="form-field"><Label htmlFor="vendor-field-2">{m4('sort', 'Sort')}</Label><Input id="vendor-field-2" type="number" value={vendorForm.sort} onChange={(e) => setVendorForm({ ...vendorForm, sort: e.target.value })} disabled={busy} /></div><label className="control-row self-end text-sm"><Switch checked={vendorForm.status === 1} onCheckedChange={(checked) => setVendorForm({ ...vendorForm, status: checked ? 1 : 0 })} disabled={busy} />{t('common.enabled')}</label></div>
        {formError && <p className="text-sm text-destructive">{formError}</p>}<DialogFooter className="form-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setVendorDialog(false)}>{t('common.cancel')}</Button><Button type="submit" disabled={busy}>{busy ? t('common.loading') : t('common.save')}</Button></DialogFooter>
      </form></DialogContent></Dialog>

      <Dialog open={accountDialog} onOpenChange={(open) => { if (!open && !busy) setAccountDialog(false) }}><DialogContent><DialogHeader><DialogTitle>{editingAccount ? m4('editAccount', 'Edit account') : m4('addAccount', 'Add account')}</DialogTitle></DialogHeader><form onSubmit={submitAccount} className="space-y-4">
        {!editingAccount && <div className="form-field"><Label htmlFor="vendors-account-vendor">{m4('providerName', 'Provider')}</Label><Select disabled={busy} value={vendorIdFilter || undefined} onValueChange={(e) => setVendorIdFilter(e)}><SelectTrigger id="vendors-account-vendor"><SelectValue placeholder={<>{m4('chooseVendor', 'Choose a provider')}</>} /></SelectTrigger><SelectContent>{vendors.map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendorTitle(vendor)}</SelectItem>)}</SelectContent></Select></div>}
        {editingAccount && <p className="text-sm text-muted-foreground">{m4('providerImmutable', 'Provider cannot be changed')}: {selectedProvider}</p>}
        <div className="form-field"><Label htmlFor="vendor-field-3">{m4('accountName', 'Account')}</Label><Input id="vendor-field-3" value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} required disabled={busy} /></div>
        <div className="form-field"><Label htmlFor="vendor-field-4">{m4('accessKey', 'Access key')}{editingAccount ? ` (${m4('optionalLeaveBlank', 'leave blank to keep current')})` : ''}</Label><Input id="vendor-field-4" autoComplete="new-password" type="password" value={accountForm.accessKey} onChange={(e) => setAccountForm({ ...accountForm, accessKey: e.target.value })} placeholder={editingAccount ? m4('credentialNotShown', 'Stored credential is not shown; blank keeps it unchanged.') : 'API Token / RAM AccessKey ID'} required={!editingAccount} disabled={busy} /></div>
        {(accountVendor(editingAccount)?.code === 'ali' || (!editingAccount && vendors.find((vendor) => vendor.id === vendorIdFilter)?.code === 'ali')) && <div className="form-field"><Label htmlFor="vendor-field-5">{m4('secretKey', 'Secret key')}{editingAccount ? ` (${m4('optionalLeaveBlank', 'leave blank to keep current')})` : ''}</Label><Input id="vendor-field-5" autoComplete="new-password" type="password" value={accountForm.secretKey} onChange={(e) => setAccountForm({ ...accountForm, secretKey: e.target.value })} placeholder={editingAccount ? m4('credentialNotShown', 'Stored credential is not shown; blank keeps it unchanged.') : 'RAM AccessKey Secret'} required={!editingAccount} disabled={busy} /></div>}
        {(accountVendor(editingAccount)?.code === 'cloudflare' || (!editingAccount && vendors.find((vendor) => vendor.id === vendorIdFilter)?.code === 'cloudflare')) && <div className="form-field"><Label htmlFor="vendor-field-6">{m4('zoneId', 'Cloudflare Zone ID')}</Label><Input id="vendor-field-6" value={accountForm.zoneId} onChange={(e) => setAccountForm({ ...accountForm, zoneId: e.target.value })} placeholder="32 hex characters" disabled={busy} /><p className="text-xs text-muted-foreground">{m4('zoneIdHint', 'Cloudflare uses an API Token; the zone ID must contain exactly 32 hexadecimal characters.')}</p></div>}
        <label className="control-row text-sm"><Switch checked={accountForm.status === 1} onCheckedChange={(checked) => setAccountForm({ ...accountForm, status: checked ? 1 : 0 })} disabled={busy} />{t('common.enabled')}</label>
        {formError && <p className="text-sm text-destructive">{formError}</p>}<DialogFooter className="form-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setAccountDialog(false)}>{t('common.cancel')}</Button><Button type="submit" disabled={busy}>{busy ? t('common.loading') : t('common.save')}</Button></DialogFooter>
      </form></DialogContent></Dialog>
    </div>
  )
}
