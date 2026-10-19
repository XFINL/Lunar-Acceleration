import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { certificateApi, type AcmeJob } from '@/api/certificate'
import { userApi } from '@/api/user'
import { domainApi, type HttpsConfig } from '@/api/domain'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/common/ConfirmAction'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectRoot as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/common/EmptyState'
import { Loading } from '@/components/common/Loading'
import { PageHeader } from '@/components/common/PageHeader'
import { Pagination } from '@/components/common/Pagination'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const DEFAULT_HTTPS: HttpsConfig = { httpsEnabled: false, forceHttps: false, hstsEnabled: false, hstsMaxAge: 0, tlsVersion: 'TLSv1.2' }

export function CertificatesPage() {
  const { t } = useTranslation()
  const tx = useCallback((key: string, fallback: string) => t(`m3.${key}`, { defaultValue: fallback }), [t])
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [jobPage, setJobPage] = useState(1)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [name, setName] = useState('')
  const [certPem, setCertPem] = useState('')
  const [keyPem, setKeyPem] = useState('')
  const [domainId, setDomainId] = useState('')
  const [certId, setCertId] = useState('')
  const [https, setHttps] = useState(DEFAULT_HTTPS)
  const [applyOpen, setApplyOpen] = useState(false)
  const [autoRenew, setAutoRenew] = useState(false)
  const [jobId, setJobId] = useState('')
  const [jobData, setJobData] = useState<AcmeJob | null>(null)
  const [jobNotice, setJobNotice] = useState('')

  const certs = useQuery({ queryKey: ['user', 'certificates', page], queryFn: () => certificateApi.list({ page, pageSize: 10 }) })
  const certificateJobs = useQuery({
    queryKey: ['user', 'certificate-jobs', jobPage],
    queryFn: () => userApi.listCertificateJobs({ page: jobPage, pageSize: 10 }),
    refetchInterval: (query) => query.state.data?.list.some((job) => ['pending', 'needs_dns', 'processing'].includes(job.status)) ? 10_000 : false,
  })
  const domains = useQuery({ queryKey: ['user', 'domains', 'select'], queryFn: () => domainApi.list({ page: 1, pageSize: 100 }) })
  const selectedDomain = domainId || domains.data?.list[0]?.id || ''
  const approvedDomains = domains.data?.list.filter((domain) => domain.auditStatus === 2) ?? []
  const applicationDomainId = approvedDomains.some((domain) => domain.id === selectedDomain) ? selectedDomain : approvedDomains[0]?.id ?? ''
  const httpsQuery = useQuery({ queryKey: ['user', 'https', selectedDomain], queryFn: () => domainApi.getHttps(selectedDomain), enabled: !!selectedDomain })
  const jobQuery = useQuery({
    queryKey: ['user', 'certificate-job', jobId],
    queryFn: () => certificateApi.getJob(jobId),
    enabled: !!jobId,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => ['pending', 'needs_dns', 'processing'].includes(query.state.data?.status ?? '') ? 10_000 : false,
  })

  useEffect(() => {
    if (!httpsQuery.data) return
    const data = httpsQuery.data
    setHttps({ httpsEnabled: data.httpsEnabled, forceHttps: data.forceHttps, hstsEnabled: data.hstsEnabled, hstsMaxAge: data.hstsMaxAge, tlsVersion: data.tlsVersion })
    setCertId(data.certId ?? '')
  }, [httpsQuery.data])

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['user', 'certificates'] })
    void qc.invalidateQueries({ queryKey: ['user', 'certificate-jobs'] })
    void qc.invalidateQueries({ queryKey: ['user', 'https', selectedDomain] })
  }, [qc, selectedDomain])
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : t('common.failed'))
  const applyJobResult = useCallback((result: AcmeJob) => {
    const alreadyIssued = jobData?.id === result.id && jobData.status === 'issued'
    setJobData(result)
    setJobId(result.id)
    void qc.invalidateQueries({ queryKey: ['user', 'certificate-jobs'] })
    if (result.status === 'needs_dns') setJobNotice(tx('dnsValidationPendingNotice', 'DNS verification is pending. Publishing the TXT record is not issuance.'))
    else if (result.status === 'processing') setJobNotice(tx('acmeProcessing', 'The request is processing; issuance is not confirmed.'))
    else if (result.status === 'failed') setJobNotice(tx('acmeFailed', 'The ACME job failed. See the error details below.'))
    else setJobNotice('')
    if (result.status === 'issued') {
      invalidate()
      if (!alreadyIssued) toast.success(tx('certificateIssued', 'The certificate was issued successfully.'))
    }
  }, [jobData, invalidate, qc, tx])

  useEffect(() => {
    if (jobQuery.data) applyJobResult(jobQuery.data)
  }, [applyJobResult, jobQuery.data])

  const upload = useMutation({
    mutationFn: () => certificateApi.upload({ name, certPem, keyPem }),
    onSuccess: () => {
      toast.success(tx('certificateSaved', 'Certificate saved securely on the server. No external CA submission was made.'))
      setUploadOpen(false); setName(''); setCertPem(''); setKeyPem(''); invalidate()
    },
    onError: (e) => { setKeyPem(''); onError(e) },
  })
  const remove = useMutation({ mutationFn: (id: string) => certificateApi.remove(id), onSuccess: invalidate, onError })
  const bind = useMutation({
    mutationFn: () => domainApi.bindCertificate(selectedDomain, certId || null),
    onSuccess: () => { toast.success(tx('savedNotDeployed', 'Saved; not yet deployed to nodes.')); invalidate() }, onError,
  })
  const saveHttps = useMutation({
    mutationFn: () => domainApi.updateHttps(selectedDomain, https),
    onSuccess: () => { toast.success(tx('savedNotDeployed', 'Saved; not yet deployed to nodes.')); invalidate() }, onError,
  })
  const apply = useMutation({
    mutationFn: () => certificateApi.apply({ domainId: applicationDomainId, autoRenew }),
    onSuccess: (result) => { applyJobResult(result); setApplyOpen(false); setAutoRenew(false) },
    onError,
  })
  const renew = useMutation({ mutationFn: (id: string) => certificateApi.renew(id), onSuccess: applyJobResult, onError })
  const complete = useMutation({
    mutationFn: () => certificateApi.completeJob(jobId),
    onSuccess: applyJobResult,
    onError: (e) => {
      onError(e)
      setJobNotice(e instanceof ApiError ? e.message : tx('validationFailed', 'DNS validation could not be completed. Check the TXT record and try again.'))
    },
  })

  const activeCerts = certs.data?.list ?? []
  const needsDns = jobData?.status === 'needs_dns'
  const jobExpired = !!jobData && ['pending', 'needs_dns', 'processing'].includes(jobData.status) && (!jobData.expiresAt || new Date(jobData.expiresAt).getTime() <= Date.now())
  const canContinue = !!needsDns && !jobExpired && !complete.isPending
  const statusText = jobData ? tx(`acmeStatus_${jobData.status}`, jobData.status) : ''
  const selectRecoveryJob = (id: string) => {
    setJobData(null)
    setJobNotice('')
    setJobId(id)
  }
  const copyRecord = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(tx('txtCopied', 'TXT value copied.'))
    } catch {
      toast.error(tx('txtCopyFailed', 'Could not copy the TXT value. Please copy it manually.'))
    }
  }

  return <div className="page-stack">
    <PageHeader title={tx('certificates', 'Certificates & HTTPS')} description={tx('certDesc', 'Manage PEM certificates and configure HTTPS for a selected domain.')} actions={<div className="form-actions"><Button variant="outline" onClick={() => setApplyOpen(true)}>{tx('applyAcme', 'Apply for ACME certificate')}</Button><Button onClick={() => setUploadOpen(true)}>{tx('uploadCertificate', 'Upload certificate')}</Button></div>} />
    <p className="notice text-sm text-muted-foreground">{tx('noDeployment', 'No real deployment is connected. Saved settings are not yet distributed to nodes.')}</p>

    <Card><CardContent className="space-y-3 p-4 md:p-6">
      <div className="section-heading">
        <div><h2 className="font-medium">{tx('recentAcmeJobs', 'Recent ACME jobs')}</h2><p className="text-sm text-muted-foreground">{tx('recoverJobHelp', 'Select a job to restore its status and, when awaiting DNS, view its TXT instructions and continue validation.')}</p></div>
        <Button variant="outline" size="sm" disabled={certificateJobs.isFetching} onClick={() => void certificateJobs.refetch()}>{t('common.refresh')}</Button>
      </div>
      {certificateJobs.isLoading ? <Loading /> : certificateJobs.isError ? <p className="text-sm text-destructive">{tx('jobsLoadFailed', 'Could not load recent certificate jobs.')} <Button size="sm" variant="outline" onClick={() => void certificateJobs.refetch()}>{t('common.refresh')}</Button></p> : !certificateJobs.data?.list.length ? <EmptyState title={tx('noRecentJobs', 'No recent ACME jobs')} /> : <>
        <Table><TableHeader><TableRow><TableHead>{tx('acmeJob', 'ACME job')}</TableHead><TableHead>{tx('domain', 'Domain')}</TableHead><TableHead>{tx('acmeStatusLabel', 'Status')}</TableHead><TableHead>{tx('createdAt', 'Created')}</TableHead><TableHead className="text-right">{t('common.actions')}</TableHead></TableRow></TableHeader><TableBody>{certificateJobs.data.list.map((job) => <TableRow key={job.id}>
          <TableCell className="font-mono text-xs">#{job.id}</TableCell>
          <TableCell className="max-w-xs break-all">{job.domains.map((item) => item.domain).filter(Boolean).join(', ') || '—'}</TableCell>
          <TableCell>{tx(`acmeStatus_${job.status}`, job.status)}</TableCell>
          <TableCell className="whitespace-nowrap">{job.createdAt ? new Date(job.createdAt).toLocaleString() : '—'}</TableCell>
          <TableCell className="text-right"><Button size="sm" variant={jobId === job.id ? 'default' : 'outline'} onClick={() => selectRecoveryJob(job.id)}>{jobId === job.id ? tx('jobSelected', 'Selected') : tx('selectRecoveryJob', 'Select to recover')}</Button></TableCell>
        </TableRow>)}</TableBody></Table>
        <Pagination page={certificateJobs.data.pagination.page} pageSize={certificateJobs.data.pagination.pageSize} total={certificateJobs.data.pagination.total} onPageChange={setJobPage} />
      </>}
    </CardContent></Card>

    {jobId && <Card><CardContent className="space-y-3 p-4 md:p-6">
      <div className="section-heading">
        <h2 className="font-medium">{tx('acmeJob', 'ACME validation job')} · <span className="font-mono text-sm">{jobId}</span></h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={jobQuery.isFetching} onClick={() => void jobQuery.refetch()}>{t('common.refresh')}</Button>
          <Button size="sm" disabled={!canContinue} onClick={() => complete.mutate()}>{tx('continueValidation', 'Continue validation')}</Button>
        </div>
      </div>
      {jobData && <p className="text-sm"><span className="font-medium">{tx('acmeStatusLabel', 'Status')}:</span> {statusText}</p>}
      {jobNotice && <p className="text-sm text-muted-foreground">{jobNotice}</p>}
      {jobQuery.isError && <p className="text-sm text-destructive">{tx('jobRefreshFailed', 'Could not refresh job details.')} <Button variant="outline" size="sm" onClick={() => void jobQuery.refetch()}>{t('common.refresh')}</Button></p>}
      {jobData?.error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><span className="font-medium">{tx('acmeError', 'Error')}:</span> {jobData.error}</p>}
      {jobExpired && <p role="status" className="text-sm text-destructive">{tx('jobExpired', 'This job has expired and cannot be continued. Start a new certificate request.')}</p>}
      {jobData?.status === 'needs_dns' && <div className="rounded-md border border-border bg-muted/50 p-3">
        <p className="font-medium">{tx('dnsValidationPending', 'DNS validation required')}</p>
        <p className="mt-1 text-sm">{tx('addTxtRecord', 'Publish the TXT record(s) below in DNS, wait for propagation, then continue validation.')}</p>
        {jobData.challenge?.records.length ? <Table className="mt-3"><TableHeader><TableRow><TableHead>{tx('txtName', 'TXT record name')}</TableHead><TableHead>{tx('txtValue', 'TXT value')}</TableHead><TableHead>{tx('domain', 'Domain')}</TableHead><TableHead className="text-right">{t('common.actions')}</TableHead></TableRow></TableHeader><TableBody>{jobData.challenge.records.map((record, index) => <TableRow key={`${record.name}-${index}`}><TableCell className="break-all font-mono text-xs">{record.name}</TableCell><TableCell className="break-all font-mono text-xs">{record.value}</TableCell><TableCell className="break-all">{record.domain}</TableCell><TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => void copyRecord(record.value)}>{tx('copyTxtValue', 'Copy value')}</Button></TableCell></TableRow>)}</TableBody></Table> : <p className="mt-2 text-sm text-muted-foreground">{tx('noTxtRecords', 'No TXT records were returned for this job.')}</p>}
      </div>}
      {jobData?.expiresAt && <p className="text-sm"><span className="font-medium">{tx('expiresAt', 'Expires at')}:</span> {jobData.expiresAt}</p>}
      {jobData?.status === 'issued' && jobData.certificateId && <p className="text-sm"><span className="font-medium">{tx('certificateId', 'Certificate ID')}:</span> <span className="font-mono">{jobData.certificateId}</span></p>}
      {jobData?.instructions && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{jobData.instructions}</p>}
    </CardContent></Card>}

    <Card><CardContent className="form-grid p-4 md:grid-cols-2 md:p-6">
      <div className="form-field"><Label htmlFor="https-domain">{tx('domain', 'Domain')}</Label>{domains.isLoading ? <Loading /> : domains.isError ? <p className="text-sm text-destructive">{tx('loadFailed', 'Could not load data.')} <Button size="sm" variant="outline" onClick={() => void domains.refetch()}>{t('common.refresh')}</Button></p> : <Select value={selectedDomain || undefined} onValueChange={(e) => { setDomainId(e); setCertId(''); setHttps(DEFAULT_HTTPS) }}><SelectTrigger id="https-domain" className="mt-1"><SelectValue placeholder={<>{tx('selectDomain', 'Select a domain')}</>} /></SelectTrigger><SelectContent>{domains.data?.list.map((d) => <SelectItem key={d.id} value={d.id}>{d.domain}</SelectItem>)}</SelectContent></Select>}</div>
      <div className="form-field"><Label htmlFor="https-certificate">{tx('bindCertificate', 'Bound certificate')}</Label><Select value={certId || '__no_certificate__'} onValueChange={(value) => setCertId(value === '__no_certificate__' ? '' : value)}><SelectTrigger id="https-certificate" className="mt-1"><SelectValue placeholder={<>{tx('noCertificate', 'No certificate')}</>} /></SelectTrigger><SelectContent><SelectItem value="__no_certificate__">{tx('noCertificate', 'No certificate')}</SelectItem>{certId && !activeCerts.some(c => c.id === certId) ? <SelectItem value={certId}>#{certId}</SelectItem> : null}{activeCerts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.notAfter ? new Date(c.notAfter).toLocaleDateString() : ''}</SelectItem>)}</SelectContent></Select><Button className="mt-2" variant="outline" disabled={!selectedDomain || !httpsQuery.data || httpsQuery.isFetching || bind.isPending} onClick={() => bind.mutate()}>{tx('bind', 'Bind certificate')}</Button><p className="mt-1 text-xs text-muted-foreground">{tx('coverageValidation', 'The server must confirm certificate validity and domain coverage before binding.')}</p></div>
    </CardContent></Card>

    <Card><CardContent className="page-stack p-4 md:p-6"><h2 className="font-medium">{tx('httpsConfig', 'HTTPS configuration')}</h2>{httpsQuery.isLoading ? <Loading /> : httpsQuery.isError ? <p className="text-sm text-destructive">{tx('loadFailed', 'Could not load data.')} <Button size="sm" variant="outline" onClick={() => void httpsQuery.refetch()}>{t('common.refresh')}</Button></p> : !selectedDomain ? <p className="text-sm text-muted-foreground">{tx('selectDomain', 'Select a domain')}</p> : <><p className="text-xs text-muted-foreground">{tx('httpsCertRequired', 'HTTPS requires a valid certificate covering the selected domain.')}</p><div className="form-grid sm:grid-cols-2">{([['httpsEnabled','Enable HTTPS'],['forceHttps','Force HTTPS'],['hstsEnabled','Enable HSTS']] as const).map(([key,label]) => <label key={key} className="control-row text-sm"><Switch checked={https[key]} onCheckedChange={(value) => setHttps({ ...https, [key]: value })} />{tx(key,label)}</label>)}<div className="form-field"><Label htmlFor="https-hsts-max-age">{tx('hstsMaxAge', 'HSTS max age (seconds)')}</Label><Input id="https-hsts-max-age" type="number" min={0} max={31536000} value={https.hstsMaxAge} onChange={(e) => setHttps({ ...https, hstsMaxAge: Number(e.target.value) })} /></div><div className="form-field"><Label htmlFor="https-tls-version">{tx('tlsVersion', 'TLS version')}</Label><Select value={https.tlsVersion} onValueChange={(e) => setHttps({ ...https, tlsVersion: e })}><SelectTrigger id="https-tls-version"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="TLSv1.2">TLS 1.2</SelectItem><SelectItem value="TLSv1.3">TLS 1.3</SelectItem></SelectContent></Select></div></div><Button disabled={!httpsQuery.data || saveHttps.isPending} onClick={() => saveHttps.mutate()}>{t('common.save')}</Button></>}</CardContent></Card>

    <Card><CardContent className="p-0">{certs.isLoading ? <Loading /> : certs.isError ? <div className="p-4 text-sm text-destructive">{tx('loadFailed', 'Could not load data.')} <Button size="sm" variant="outline" onClick={() => void certs.refetch()}>{t('common.refresh')}</Button></div> : !activeCerts.length ? <EmptyState title={t('common.noData')} /> : <><Table><TableHeader><TableRow><TableHead>{tx('certificateName', 'Name')}</TableHead><TableHead>{tx('issuer', 'Issuer')}</TableHead><TableHead>{tx('validFrom', 'Valid from')}</TableHead><TableHead>{tx('validUntil', 'Valid until')}</TableHead><TableHead>{tx('privateKeyAvailable', 'Private key')}</TableHead><TableHead>{tx('autoRenew', 'Auto-renew')}</TableHead><TableHead className="text-right">{t('common.actions')}</TableHead></TableRow></TableHeader><TableBody>{activeCerts.map((c) => <TableRow key={c.id}><TableCell>{c.name}</TableCell><TableCell>{c.issuer || '—'}</TableCell><TableCell>{c.notBefore ? new Date(c.notBefore).toLocaleDateString() : '—'}</TableCell><TableCell>{c.notAfter ? new Date(c.notAfter).toLocaleDateString() : '—'}</TableCell><TableCell>{c.hasPrivateKey ? t('common.enabled') : t('common.disabled')}</TableCell><TableCell>{c.autoRenew ? t('common.enabled') : '—'}</TableCell><TableCell className="text-right"><div className="data-actions"><Button size="sm" variant="outline" disabled={renew.isPending} onClick={() => renew.mutate(c.id)}>{tx('renew', 'Renew')}</Button><ConfirmAction title={tx('deleteCertificate', 'Delete certificate')} description={tx('deleteCertificateConfirm', 'Delete this certificate?')} onConfirm={() => remove.mutate(c.id)}><Button variant="ghost" size="icon" aria-label={`${tx('deleteCertificate', 'Delete certificate')} ${c.name}`} className="text-destructive" disabled={remove.isPending}><Trash2 className="h-4 w-4" /></Button></ConfirmAction></div></TableCell></TableRow>)}</TableBody></Table><div className="px-4 pb-4"><Pagination page={certs.data!.pagination.page} pageSize={certs.data!.pagination.pageSize} total={certs.data!.pagination.total} onPageChange={setPage} /></div></>}</CardContent></Card>

    <Dialog open={applyOpen} onOpenChange={setApplyOpen}><DialogContent><DialogHeader><DialogTitle>{tx('applyAcme', 'Apply for ACME certificate')}</DialogTitle><DialogDescription>{tx('acmeSafety', 'The server controls whether an ACME provider is configured. No external certificate authority is contacted unless the backend explicitly supports it; an application response is not proof of issuance.')}</DialogDescription></DialogHeader><div className="space-y-3"><div className="form-field"><Label htmlFor="acme-domain">{tx('domain', 'Domain')}</Label><Select value={applicationDomainId || undefined} onValueChange={(e) => setDomainId(e)}><SelectTrigger id="acme-domain"><SelectValue placeholder={<>{tx('selectApprovedDomain', 'Select an approved domain')}</>} /></SelectTrigger><SelectContent>{approvedDomains.map((d) => <SelectItem key={d.id} value={d.id}>{d.domain}</SelectItem>)}</SelectContent></Select>{!approvedDomains.length && <p className="text-sm text-destructive">{tx('approvedDomainRequired', 'Only approved domains can be used for an ACME application.')}</p>}</div><label className="control-row text-sm"><Switch checked={autoRenew} onCheckedChange={setAutoRenew} />{tx('autoRenew', 'Enable auto-renew for this application')}</label>{autoRenew && <p className="text-sm text-muted-foreground dark:text-muted-foreground">{tx('autoRenewCfNotice', 'Auto-renew requires automatic DNS configuration through Cloudflare to be configured on the server.')}</p>}</div><DialogFooter><Button variant="outline" onClick={() => setApplyOpen(false)}>{t('common.cancel')}</Button><Button disabled={!applicationDomainId || apply.isPending} onClick={() => apply.mutate()}>{tx('submitAcme', 'Submit application')}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={uploadOpen} onOpenChange={(open) => { setUploadOpen(open); if (!open) { setCertPem(''); setKeyPem('') } }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{tx('uploadCertificate', 'Upload certificate')}</DialogTitle></DialogHeader><p className="rounded-md bg-muted p-3 text-sm">{tx('pemStorageNotice', 'PEM data is saved encrypted on this server only. It is not submitted to an external certificate authority. Private-key text is transient and cleared after upload or close.')}</p><div className="space-y-3"><div className="form-field"><Label htmlFor="pem-certificate-name">{tx('certificateName', 'Name')}</Label><Input id="pem-certificate-name" value={name} onChange={(e) => setName(e.target.value)} /></div><div className="form-field"><Label htmlFor="pem-certificate">{tx('certPem', 'Certificate PEM')}</Label><Textarea id="pem-certificate" autoComplete="off" spellCheck={false} rows={5} value={certPem} onChange={(e) => setCertPem(e.target.value)} /></div><div className="form-field"><Label htmlFor="pem-private-key">{tx('keyPem', 'Private key PEM (sensitive)')}</Label><Textarea id="pem-private-key" autoComplete="new-password" spellCheck={false} rows={5} value={keyPem} onChange={(e) => setKeyPem(e.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => { setUploadOpen(false); setCertPem(''); setKeyPem('') }}>{t('common.cancel')}</Button><Button disabled={!name.trim() || !certPem.trim() || !keyPem.trim() || upload.isPending} onClick={() => upload.mutate()}>{t('common.submit')}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
