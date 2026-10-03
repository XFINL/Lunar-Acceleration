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
import { Select } from '@/components/ui/select'
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

function parseFeatureFlags(raw: string | null): { features: Record<string, boolean>; maxCacheRules: string } {
  const features: Record<string, boolean> = Object.fromEntries(
    FEATURE_FLAGS.map((flag) => [flag, false]),
  )
  let maxCacheRules = ''
  if (!raw) return { features, maxCacheRules }
  try {
    const parsed = JSON.parse(raw) as unknown
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
    <div>
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

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex min-w-[12rem] flex-1 items-center gap-2">
            <Input
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
              onClick={() => {
                setPage(1)
                setAppliedKeyword(keyword)
              }}
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
          <Select
            className="w-[9rem]"
            value={statusFilter}
            onChange={(event) => {
              setPage(1)
              setStatusFilter(event.target.value)
            }}
          >
            <option value="">{t('common.status')}: {t('common.all')}</option>
            <option value={PackageStatus.ONLINE}>{t('packages.statusOnline')}</option>
            <option value={PackageStatus.OFFLINE}>{t('packages.statusOffline')}</option>
          </Select>
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
                      <TableCell className="whitespace-nowrap">
                        ¥ {pkg.price} / {PACKAGE_PERIOD_MAP[pkg.period as PackagePeriod] ?? '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatBytes(pkg.trafficQuota)}</TableCell>
                      <TableCell>
                        <Badge variant={pkg.status === PackageStatus.ONLINE ? 'success' : 'secondary'}>
                          {pkg.status === PackageStatus.ONLINE
                            ? t('packages.statusOnline')
                            : t('packages.statusOffline')}
                        </Badge>
                      </TableCell>
                      <TableCell>{pkg.sort}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
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
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            title={t('common.delete')}
                            onClick={() => {
                              if (window.confirm(t('admin.deletePackageConfirm'))) {
                                deleteMutation.mutate(pkg.id)
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('admin.packageName')}</Label>
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('admin.packageCode')}</Label>
                <Input
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('admin.description')}</Label>
              <Input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('admin.accessType')}</Label>
                <Select
                  value={form.accessType}
                  onChange={(event) =>
                    setForm({ ...form, accessType: Number(event.target.value) })
                  }
                >
                  {ACCESS_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {PACKAGE_ACCESS_TYPE_MAP[type]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('admin.period')}</Label>
                <Select
                  value={form.period}
                  onChange={(event) => setForm({ ...form, period: Number(event.target.value) })}
                >
                  {PERIODS.map((period) => (
                    <option key={period} value={period}>
                      {PACKAGE_PERIOD_MAP[period]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('admin.trafficQuotaGb')}</Label>
                <Input
                  type="number"
                  value={form.trafficGb}
                  onChange={(event) => setForm({ ...form, trafficGb: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('admin.bandwidthLimit')}</Label>
                <Input
                  type="number"
                  value={form.bandwidthLimit}
                  onChange={(event) => setForm({ ...form, bandwidthLimit: event.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('admin.domainLimit')}</Label>
                <Input
                  type="number"
                  value={form.domainLimit}
                  onChange={(event) => setForm({ ...form, domainLimit: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('admin.requestQuota')}</Label>
                <Input
                  type="number"
                  value={form.requestQuota}
                  onChange={(event) => setForm({ ...form, requestQuota: event.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('admin.price')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.price}
                  onChange={(event) => setForm({ ...form, price: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('admin.overQuotaPolicy')}</Label>
                <Select
                  value={form.overQuotaPolicy}
                  onChange={(event) =>
                    setForm({ ...form, overQuotaPolicy: Number(event.target.value) })
                  }
                >
                  {OVER_QUOTA_POLICIES.map((policy) => (
                    <option key={policy} value={policy}>
                      {OVER_QUOTA_POLICY_MAP[policy]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('admin.sort')}</Label>
                <Input
                  type="number"
                  value={form.sort}
                  onChange={(event) => setForm({ ...form, sort: event.target.value })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <Label>{t('common.status')}</Label>
                <Switch
                  checked={form.status === PackageStatus.ONLINE}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, status: checked ? PackageStatus.ONLINE : PackageStatus.OFFLINE })
                  }
                />
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">{t('admin.featureFlags')}</p>
              {FEATURE_FLAGS.map((flag) => (
                <div key={flag} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t(`packages.feature.${flag}`)}
                  </span>
                  <Switch
                    checked={form.features[flag] ?? false}
                    onCheckedChange={(checked) =>
                      setForm({ ...form, features: { ...form.features, [flag]: checked } })
                    }
                  />
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <Label>{t('packages.maxCacheRules')}</Label>
                <Input
                  type="number"
                  className="w-32"
                  value={form.maxCacheRules}
                  onChange={(event) => setForm({ ...form, maxCacheRules: event.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
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
