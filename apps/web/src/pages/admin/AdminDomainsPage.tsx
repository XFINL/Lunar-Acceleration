import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { adminDomainApi, type Domain } from '@/api/domain'
import { useAuthStore, selectHasPermission } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/common/EmptyState'
import { Loading } from '@/components/common/Loading'
import { PageHeader } from '@/components/common/PageHeader'
import { ConfirmAction } from '@/components/common/ConfirmAction'
import { Pagination } from '@/components/common/Pagination'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function AdminDomainsPage() {
  const { t } = useTranslation(); const tx = (key: string, fallback: string) => t(`m3.${key}`, { defaultValue: fallback }); const qc = useQueryClient()
  const canRead = useAuthStore(selectHasPermission('domain:read')); const [page, setPage] = useState(1); const [auditMode, setAuditMode] = useState(false)
  const query = useQuery({ queryKey: ['admin', 'domains', auditMode ? 'audit' : 'all', page], queryFn: () => auditMode ? adminDomainApi.audit({ page, pageSize: 10 }) : adminDomainApi.list({ page, pageSize: 10 }), enabled: canRead })
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['admin', 'domains'] }) }; const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('common.failed'))
  const review = useMutation({ mutationFn: ({ item, approve }: { item: Domain; approve: boolean }) => { const remark = window.prompt(tx('reviewRemark', 'Optional review note')) ?? undefined; return approve ? adminDomainApi.approve(item.id, remark) : adminDomainApi.reject(item.id, remark) }, onSuccess: () => { toast.success(t('common.success')); invalidate() }, onError })
  const offline = useMutation({ mutationFn: (id: string) => adminDomainApi.offline(id), onSuccess: () => { toast.success(t('common.success')); invalidate() }, onError })
  const statuses: Record<number,string> = { 1: tx('pendingReview','Pending review'), 2: tx('deploying','Deploying'), 3: tx('enabled','Enabled'), 4: tx('disabled','Disabled'), 5: tx('rejected','Rejected'), 6: tx('deleted','Deleted') }
  if (!canRead) return <div className="page-stack"><PageHeader title={tx('adminDomains','Domain review')} /><Card><CardContent className="p-4 md:p-6 text-sm text-destructive">{tx('permissionDenied','You do not have the domain:read permission.')}</CardContent></Card></div>
  return <div className="page-stack"><PageHeader title={tx('adminDomains','Domain review')} description={tx('adminDomainsDesc','Review requests and manage domain status. Approval is not deployment or activation.')} />
    <div className="control-row flex-wrap"><Button variant={auditMode ? 'outline' : 'default'} onClick={() => { setAuditMode(false); setPage(1) }}>{tx('allDomains','All domains')}</Button><Button variant={auditMode ? 'default' : 'outline'} onClick={() => { setAuditMode(true); setPage(1) }}>{tx('audit','Review queue')}</Button></div>
    <p className="notice text-sm text-muted-foreground">{tx('adminNoDeployment','There is no real deployment. Approval and DNS success do not enable a domain; configuration is not pushed to nodes.')}</p>
    <Card><CardContent className="p-0">{query.isLoading ? <Loading /> : query.isError ? <div className="p-4 md:p-6 text-sm text-destructive">{tx('loadFailed','Could not load data.')} <Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t('common.refresh')}</Button></div> : !query.data?.list.length ? <EmptyState title={t('common.noData')} /> : <><Table><TableHeader><TableRow><TableHead>{tx('domain','Domain')}</TableHead><TableHead>{tx('cname','CNAME')}</TableHead><TableHead>{tx('status','Status')}</TableHead><TableHead>{tx('audit','Review')}</TableHead><TableHead>{tx('businessType','Business type')}</TableHead><TableHead>{t('common.createdAt')}</TableHead><TableHead className="text-right">{t('common.actions')}</TableHead></TableRow></TableHeader><TableBody>{query.data.list.map((d) => <TableRow key={d.id}><TableCell className="font-medium">{d.domain}</TableCell><TableCell className="font-mono text-xs">{d.cname}</TableCell><TableCell>{statuses[d.status] ?? '—'}</TableCell><TableCell>{d.auditStatus === 2 ? tx('approved','Approved') : d.auditStatus === 3 ? tx('rejected','Rejected') : tx('pendingReview','Pending review')}</TableCell><TableCell>{d.businessType || '—'}</TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '—'}</TableCell><TableCell><div className="data-actions">{d.auditStatus === 1 && <><Button size="sm" onClick={() => review.mutate({ item: d, approve: true })}>{tx('approve','Approve')}</Button><Button size="sm" variant="outline" onClick={() => review.mutate({ item: d, approve: false })}>{tx('reject','Reject')}</Button></>}{d.status === 3 && <ConfirmAction title={tx('offline', 'Offline')} description={tx('offlineConfirm','Take this domain offline?')} onConfirm={() => offline.mutate(d.id)}><Button size="sm" variant="outline" disabled={offline.isPending}>{tx('offline','Offline')}</Button></ConfirmAction>}</div></TableCell></TableRow>)}</TableBody></Table><div className="px-4 pb-4"><Pagination page={query.data.pagination.page} pageSize={query.data.pagination.pageSize} total={query.data.pagination.total} onPageChange={setPage} /></div></>}</CardContent></Card>
  </div>
}
