import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  OverQuotaPolicy,
  OVER_QUOTA_POLICY_MAP,
  PACKAGE_ACCESS_TYPE_MAP,
  PACKAGE_PERIOD_MAP,
  PackageAccessType,
  PackagePeriod,
  PackageStatus,
} from '@lunar/shared'
import { adminApi, type PackagePayload } from '@/api/admin'
import { vendorApi, type Vendor } from '@/api/vendor'
import type { PackageVo } from '@/api/types'
import { ApiError } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/common/EmptyState'
import { Loading } from '@/components/common/Loading'
import { PageHeader } from '@/components/common/PageHeader'
import { ConfirmAction } from '@/components/common/ConfirmAction'
import { Pagination } from '@/components/common/Pagination'

const PAGE_SIZE = 10

const ACCESS_TYPES = [PackageAccessType.SELF_NODE, PackageAccessType.VENDOR, PackageAccessType.HYBRID]
const PERIODS = [PackagePeriod.MONTH, PackagePeriod.QUARTER, PackagePeriod.YEAR]
const OVER_QUOTA_POLICIES = [
  OverQuotaPolicy.LIMIT_SPEED,
  OverQuotaPolicy.PAY_AS_YOU_GO,
  OverQuotaPolicy.SUSPEND,
]
const FEATURE_FLAGS = ['waf', 'realtime_log', 'log_delivery', 'custom_cache_key', 'ip_region_block']

const BYTES_PER_GB = 1024 ** 3

interface PackageForm {
  name: string
  code: string
  description: string
  accessType: number
  vendorId: string
  trafficGb: string
  bandwidthLimit: string
  domainLimit: string
  requestQuota: string
  price: string
  period: number
  overQuotaPolicy: number
  status: number
  sort: string
  features: Record<string, boolean>
  maxCacheRules: string
}

const EMPTY_FORM: PackageForm = {
  name: '',
  code: '',
  description: '',
  accessType: PackageAccessType.SELF_NODE,
  vendorId: '',
  trafficGb: '',
  bandwidthLimit: '',
  domainLimit: '',
  requestQuota: '',
  price: '',
  period: PackagePeriod.MONTH,
  overQuotaPolicy: OverQuotaPolicy.LIMIT_SPEED,
  status: PackageStatus.ONLINE,
  sort: '0',
  features: Object.fromEntries(FEATURE_FLAGS.map((flag) => [flag, false])),
  maxCacheRules: '',
}

function parseFeatureFlags(raw: unknown): { features: Record<string, boolean>; maxCacheRules: string } {
  const features: Record<string, boolean> = Object.fromEntries(
    FEATURE_FLAGS.map((flag) => [flag, false]),
  )
  let maxCacheRules = ''
  if (!raw) return { features, maxCacheRules }
  try {
    // 后端以 JSON 形式返回，可能是对象 / 数组，也可能是 JSON 字符串
    const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === 'string' && item in features) features[item] = true
      }
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      for (const flag of FEATURE_FLAGS) features[flag] = obj[flag] === true
      if (typeof obj.max_cache_rules === 'number') maxCacheRules = String(obj.max_cache_rules)
    }
  } catch {
    // 非法 JSON，忽略
  }
  return { features, maxCacheRules }
}

function buildFeatureFlags(form: PackageForm): string {
  return JSON.stringify({
    ...form.features,
    max_cache_rules: Number(form.maxCacheRules) || 0,
  })
}

function buildPayload(form: PackageForm): PackagePayload {
  return {
    name: form.name,
    code: form.code,
    description: form.description || undefined,
    accessType: form.accessType,
    vendorId: form.accessType === PackageAccessType.SELF_NODE ? null : form.vendorId || null,
    trafficQuota: form.trafficGb ? Math.round(Number(form.trafficGb) * BYTES_PER_GB) : undefined,
    bandwidthLimit: form.bandwidthLimit ? Number(form.bandwidthLimit) : undefined,
    domainLimit: form.domainLimit ? Number(form.domainLimit) : undefined,
    requestQuota: form.requestQuota ? Number(form.requestQuota) : undefined,
    featureFlags: buildFeatureFlags(form),
    overQuotaPolicy: form.overQuotaPolicy,
    price: form.price || undefined,
    period: form.period,
    status: form.status,
    sort: form.sort ? Number(form.sort) : undefined,
  }
}

function packageToForm(pkg: PackageVo): PackageForm {
  const { features, maxCacheRules } = parseFeatureFlags(pkg.featureFlags)
  const gb = Number(pkg.trafficQuota) / BYTES_PER_GB
  return {
    name: pkg.name,
    code: pkg.code,
    description: pkg.description ?? '',
    accessType: pkg.accessType,
    vendorId: pkg.vendorId ?? '',
    trafficGb: Number.isFinite(gb) && gb > 0 ? String(Number(gb.toFixed(4))) : '',
    bandwidthLimit: String(pkg.bandwidthLimit),
    domainLimit: String(pkg.domainLimit),
    requestQuota: pkg.requestQuota,
    price: pkg.price,
    period: pkg.period,
    overQuotaPolicy: pkg.overQuotaPolicy,
    status: pkg.status,
    sort: String(pkg.sort),
    features,
    maxCacheRules,
  }
}

function formatBytes(value: string | null | undefined): string {
  const bytes = Number(value ?? 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let size = bytes
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size % 1 === 0 ? size : size.toFixed(2)} ${units[index]}`
}

export function AdminPackagesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<PackageForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'packages', page, appliedKeyword, statusFilter],
    queryFn: () =>
      adminApi.listPackages({
        page,
        pageSize: PAGE_SIZE,
        keyword: appliedKeyword || undefined,
        status: statusFilter === '' ? undefined : Number(statusFilter),
      }),
  })

  const vendorsQuery = useQuery({
    queryKey: ['admin', 'package-vendors'],
    queryFn: async () => {
      const pageSize = 100
      const first = await vendorApi.listVendors({ page: 1, pageSize })
      const vendors: Vendor[] = [...first.list]
      for (let page = 2; vendors.length < first.pagination.total; page += 1) {
        const next = await vendorApi.listVendors({ page, pageSize })
        if (next.list.length === 0) break
        vendors.push(...next.list)
      }
      return vendors.filter((vendor) => vendor.status === 1)
    },
  })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'packages'] })

  const onError = (error: unknown) =>
    toast.error(error instanceof ApiError ? error.message : t('common.failed'))

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = buildPayload(form)
      return editingId ? adminApi.updatePackage(editingId, payload) : adminApi.createPackage(payload)
    },
    onSuccess: () => {
      toast.success(t('common.success'))
      setCreateOpen(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
      invalidate()
    },
    onError,
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: number }) =>
      adminApi.updatePackageStatus(id, status),
    onSuccess: () => {
      toast.success(t('common.success'))
      invalidate()
    },
    onError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deletePackage(id),
    onSuccess: () => {
      toast.success(t('common.success'))
      invalidate()
    },
    onError,
  })

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setCreateOpen(true)
  }

  const openEdit = (pkg: PackageVo) => {
    setEditingId(pkg.id)
    setForm(packageToForm(pkg))
    setCreateOpen(true)
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={t('admin.packages')}
        description={t('admin.packagesDesc')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t('admin.createPackage')}
          </Button>
        }
      />

      <Card>
        <CardContent className="filter-toolbar p-4 md:p-6">
          <div className="control-row min-w-[12rem] flex-1">
            <Input
              aria-label={t('common.keyword')}
              placeholder={t('common.keyword')}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setPage(1)
                  setAppliedKeyword(keyword)
                }
              }}
            />
            <Button
              variant="outline"
              aria-label={t('common.search')}
              onClick={() => {
                setPage(1)
                setAppliedKeyword(keyword)
              }}
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
          <SelectRoot value={statusFilter || "__radix_select_empty__"} onValueChange={(event) => {
              setPage(1)
              setStatusFilter(event === "__radix_select_empty__" ? '' : event)
            }}><SelectTrigger id="adminpackagespage-select-1" className="w-[9rem]" aria-label={t('common.status')}><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="__radix_select_empty__">{t('common.status')}: {t('common.all')}</SelectItem>
            <SelectItem value={String(PackageStatus.ONLINE)}>{t('packages.statusOnline')}</SelectItem>
            <SelectItem value={String(PackageStatus.OFFLINE)}>{t('packages.statusOffline')}</SelectItem>
          </SelectContent></SelectRoot>
          <Button
            variant="ghost"
            onClick={() => {
              setKeyword('')
              setAppliedKeyword('')
              setStatusFilter('')
              setPage(1)
            }}
          >
            {t('common.reset')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <Loading />
          ) : !data || data.list.length === 0 ? (
            <EmptyState title={t('common.noData')} />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin.packageName')}</TableHead>
                    <TableHead>{t('admin.packageCode')}</TableHead>
                    <TableHead>{t('admin.accessType')}</TableHead>
                    <TableHead>{t('admin.price')}</TableHead>
                    <TableHead>{t('packages.traffic')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('admin.sort')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.list.map((pkg) => (
                    <TableRow key={pkg.id}>
                      <TableCell className="font-medium">
                        {pkg.name}
                        {pkg.description ? (
                          <p className="text-xs text-muted-foreground">{pkg.description}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{pkg.code}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {PACKAGE_ACCESS_TYPE_MAP[pkg.accessType as PackageAccessType] ?? '-'}
                        </Badge>
                      </TableCell>
                      <TableCell className="numeric whitespace-nowrap">
                        ¥ {pkg.price} / {PACKAGE_PERIOD_MAP[pkg.period as PackagePeriod] ?? '-'}
                      </TableCell>
                      <TableCell className="numeric whitespace-nowrap">{formatBytes(pkg.trafficQuota)}</TableCell>
                      <TableCell>
                        <Badge variant={pkg.status === PackageStatus.ONLINE ? 'success' : 'secondary'}>
                          {pkg.status === PackageStatus.ONLINE
                            ? t('packages.statusOnline')
                            : t('packages.statusOffline')}
                        </Badge>
                      </TableCell>
                      <TableCell className="numeric">{pkg.sort}</TableCell>
                      <TableCell>
                        <div className="data-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              statusMutation.mutate({
                                id: pkg.id,
                                status:
                                  pkg.status === PackageStatus.ONLINE
                                    ? PackageStatus.OFFLINE
                                    : PackageStatus.ONLINE,
                              })
                            }
                          >
                            {pkg.status === PackageStatus.ONLINE
                              ? t('admin.offline')
                              : t('admin.online')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('common.edit')}
                            onClick={() => openEdit(pkg)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <ConfirmAction
                            title={t('common.delete')}
                            description={t('admin.deletePackageConfirm')}
                            onConfirm={() => deleteMutation.mutate(pkg.id)}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              title={t('common.delete')}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </ConfirmAction>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="px-4 pb-4">
                <Pagination
                  page={data.pagination.page}
                  pageSize={data.pagination.pageSize}
                  total={data.pagination.total}
                  onPageChange={setPage}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 新建 / 编辑套餐 */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setEditingId(null)
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('admin.editPackage') : t('admin.createPackage')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="form-grid">
              <div className="form-field">
                <Label htmlFor="package-name">{t('admin.packageName')}</Label>
                <Input
                  id="package-name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </div>
              <div className="form-field">
                <Label htmlFor="package-code">{t('admin.packageCode')}</Label>
                <Input
                  id="package-code"
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
              </div>
            </div>
            <div className="form-field">
              <Label htmlFor="package-description">{t('admin.description')}</Label>
              <Input
                id="package-description"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </div>
            <div className="form-grid">
              <div className="form-field">
                <Label htmlFor="adminpackagespage-select-2">{t('admin.accessType')}</Label>
                <SelectRoot value={String(form.accessType)} onValueChange={(event) =>
                    setForm({
                      ...form,
                      accessType: Number(event),
                      ...(Number(event) === PackageAccessType.SELF_NODE ? { vendorId: '' } : {}),
                    })
                  }><SelectTrigger id="adminpackagespage-select-2" aria-label={t('admin.accessType')}><SelectValue /></SelectTrigger><SelectContent>
                  {ACCESS_TYPES.map((type) => (
                    <SelectItem key={type} value={String(type)}>
                      {PACKAGE_ACCESS_TYPE_MAP[type]}
                    </SelectItem>
                  ))}
                </SelectContent></SelectRoot>
              </div>
              <div className="form-field">
                <Label htmlFor="package-vendor">{t('admin.vendorMapping')}</Label>
                {form.accessType === PackageAccessType.SELF_NODE ? (
                  <p className="text-sm text-muted-foreground">{t('admin.selfHostedPackageNoVendor')}</p>
                ) : (
                  <>
                    <SelectRoot
                      value={form.vendorId || '__no_vendor_mapping__'}
                      onValueChange={(value) =>
                        setForm({ ...form, vendorId: value === '__no_vendor_mapping__' ? '' : value })
                      }
                    >
                      <SelectTrigger id="package-vendor" aria-label={t('admin.vendorMapping')} disabled={vendorsQuery.isLoading}>
                        <SelectValue placeholder={t('admin.selectEnabledVendor')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__no_vendor_mapping__">{t('admin.noVendorConfigured')}</SelectItem>
                        {form.vendorId && !vendorsQuery.data?.some((vendor) => vendor.id === form.vendorId) ? (
                          <SelectItem value={form.vendorId} disabled>{t('admin.currentVendorMappingUnavailable', { vendorId: form.vendorId })}</SelectItem>
                        ) : null}
                        {(vendorsQuery.data ?? []).map((vendor) => (
                          <SelectItem key={vendor.id} value={vendor.id}>
                            {vendor.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </SelectRoot>
                    <p className="text-sm text-muted-foreground">
                      {!vendorsQuery.isLoading && vendorsQuery.isError
                        ? t('admin.vendorMappingLoadFailed')
                        : t('admin.cloudRegistrationNeedsVendor')}
                    </p>
                  </>
                )}
              </div>
              <div className="form-field">
                <Label htmlFor="adminpackagespage-select-3">{t('admin.period')}</Label>
                <SelectRoot value={String(form.period)} onValueChange={(event) => setForm({ ...form, period: Number(event) })}><SelectTrigger id="adminpackagespage-select-3" aria-label={t('admin.period')}><SelectValue /></SelectTrigger><SelectContent>
                  {PERIODS.map((period) => (
                    <SelectItem key={period} value={String(period)}>
                      {PACKAGE_PERIOD_MAP[period]}
                    </SelectItem>
                  ))}
                </SelectContent></SelectRoot>
              </div>
            </div>
            <div className="form-grid">
              <div className="form-field">
                <Label htmlFor="package-traffic-quota">{t('admin.trafficQuotaGb')}</Label>
                <Input
                  id="package-traffic-quota"
                  type="number"
                  value={form.trafficGb}
                  onChange={(event) => setForm({ ...form, trafficGb: event.target.value })}
                />
              </div>
              <div className="form-field">
                <Label htmlFor="package-bandwidth-limit">{t('admin.bandwidthLimit')}</Label>
                <Input
                  id="package-bandwidth-limit"
                  type="number"
                  value={form.bandwidthLimit}
                  onChange={(event) => setForm({ ...form, bandwidthLimit: event.target.value })}
                />
              </div>
            </div>
            <div className="form-grid">
              <div className="form-field">
                <Label htmlFor="package-domain-limit">{t('admin.domainLimit')}</Label>
                <Input
                  id="package-domain-limit"
                  type="number"
                  value={form.domainLimit}
                  onChange={(event) => setForm({ ...form, domainLimit: event.target.value })}
                />
              </div>
              <div className="form-field">
                <Label htmlFor="package-request-quota">{t('admin.requestQuota')}</Label>
                <Input
                  id="package-request-quota"
                  type="number"
                  value={form.requestQuota}
                  onChange={(event) => setForm({ ...form, requestQuota: event.target.value })}
                />
              </div>
            </div>
            <div className="form-grid">
              <div className="form-field">
                <Label htmlFor="package-price">{t('admin.price')}</Label>
                <Input
                  id="package-price"
                  type="number"
                  step="0.01"
                  value={form.price}
                  onChange={(event) => setForm({ ...form, price: event.target.value })}
                />
              </div>
              <div className="form-field">
                <Label htmlFor="adminpackagespage-select-4">{t('admin.overQuotaPolicy')}</Label>
                <SelectRoot value={String(form.overQuotaPolicy)} onValueChange={(event) =>
                    setForm({ ...form, overQuotaPolicy: Number(event) })
                  }><SelectTrigger id="adminpackagespage-select-4" aria-label={t('admin.overQuotaPolicy')}><SelectValue /></SelectTrigger><SelectContent>
                  {OVER_QUOTA_POLICIES.map((policy) => (
                    <SelectItem key={policy} value={String(policy)}>
                      {OVER_QUOTA_POLICY_MAP[policy]}
                    </SelectItem>
                  ))}
                </SelectContent></SelectRoot>
              </div>
            </div>
            <div className="form-grid">
              <div className="form-field">
                <Label htmlFor="package-sort">{t('admin.sort')}</Label>
                <Input
                  id="package-sort"
                  type="number"
                  value={form.sort}
                  onChange={(event) => setForm({ ...form, sort: event.target.value })}
                />
              </div>
              <label className="control-row justify-between rounded-md border px-3">
                <span>{t('common.status')}</span>
                <Switch
                  checked={form.status === PackageStatus.ONLINE}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, status: checked ? PackageStatus.ONLINE : PackageStatus.OFFLINE })
                  }
                />
            </label>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">{t('admin.featureFlags')}</p>
              {FEATURE_FLAGS.map((flag) => (
                <label key={flag} className="control-row justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t(`packages.feature.${flag}`)}
                  </span>
                  <Switch
                    checked={form.features[flag] ?? false}
                    onCheckedChange={(checked) =>
                      setForm({ ...form, features: { ...form.features, [flag]: checked } })
                    }
                  />
                </label>
              ))}
              <div className="control-row justify-between pt-1">
                <Label htmlFor="package-max-cache-rules">{t('packages.maxCacheRules')}</Label>
                <Input
                  id="package-max-cache-rules"
                  type="number"
                  className="w-32"
                  value={form.maxCacheRules}
                  onChange={(event) => setForm({ ...form, maxCacheRules: event.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="form-actions">
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false)
                setEditingId(null)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              disabled={saveMutation.isPending || !form.name || !form.code}
              onClick={() => saveMutation.mutate()}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
