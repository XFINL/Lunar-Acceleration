import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import {
  PACKAGE_PERIOD_MAP,
  PackagePeriod,
  UserPackageStatus,
  type PackageAccessType,
  PACKAGE_ACCESS_TYPE_MAP,
} from '@lunar/shared'
import { orderApi } from '@/api/order'
import { packageApi } from '@/api/package'
import type { PackageVo } from '@/api/types'
import { ApiError } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/common/EmptyState'
import { Loading } from '@/components/common/Loading'
import { PageHeader } from '@/components/common/PageHeader'
import { Pagination } from '@/components/common/Pagination'

const PAGE_SIZE = 12

const FEATURE_FLAGS = ['waf', 'realtime_log', 'log_delivery', 'custom_cache_key', 'ip_region_block']

const USER_PACKAGE_STATUS_KEY: Record<number, string> = {
  [UserPackageStatus.ACTIVE]: 'packages.statusActive',
  [UserPackageStatus.EXPIRED]: 'packages.statusExpired',
  [UserPackageStatus.CANCELLED]: 'packages.statusCancelled',
}

const USER_PACKAGE_STATUS_VARIANT: Record<number, 'success' | 'warning' | 'secondary'> = {
  [UserPackageStatus.ACTIVE]: 'success',
  [UserPackageStatus.EXPIRED]: 'warning',
  [UserPackageStatus.CANCELLED]: 'secondary',
}

/** 将 JSON（对象或数组）形式的 featureFlags 解析为特性标识数组 */
function parseFeatureFlags(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      return FEATURE_FLAGS.filter((flag) => obj[flag] === true)
    }
  } catch {
    // 非法 JSON：退化为逗号分隔
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
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

function formatCount(value: string | null | undefined): string {
  const count = Number(value ?? 0)
  if (!Number.isFinite(count)) return '—'
  return count.toLocaleString()
}

function formatBandwidth(kbps: number): string {
  if (kbps >= 1024 * 1024) return `${(kbps / 1024 / 1024).toFixed(1)} Gbps`
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} Mbps`
  return `${kbps} Kbps`
}

export function PackagesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [buyTarget, setBuyTarget] = useState<PackageVo | null>(null)
  const [quantity, setQuantity] = useState('1')

  const { data: myPackage } = useQuery({
    queryKey: ['user', 'my-package'],
    queryFn: packageApi.getMyPackage,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['user', 'packages', page, appliedKeyword],
    queryFn: () =>
      packageApi.listPackages({
        page,
        pageSize: PAGE_SIZE,
        keyword: appliedKeyword || undefined,
      }),
  })

  const buyMutation = useMutation({
    mutationFn: () => {
      if (!buyTarget) throw new Error('no target')
      return orderApi.createOrder({ packageId: buyTarget.id, quantity: Number(quantity) || 1 })
    },
    onSuccess: () => {
      toast.success(t('packages.buySuccess'))
      setBuyTarget(null)
      setQuantity('1')
      void queryClient.invalidateQueries({ queryKey: ['user', 'orders'] })
      navigate('/orders')
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.failed')),
  })

  return (
    <div>
      <PageHeader title={t('packages.title')} description={t('packages.desc')} />

      {/* 我的套餐 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('packages.myPackage')}</CardTitle>
        </CardHeader>
        <CardContent>
          {myPackage ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-lg font-semibold">{myPackage.name}</span>
                <Badge variant="outline">{myPackage.code}</Badge>
                <Badge variant={USER_PACKAGE_STATUS_VARIANT[myPackage.status] ?? 'secondary'}>
                  {t(USER_PACKAGE_STATUS_KEY[myPackage.status] ?? 'packages.statusActive')}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {t('packages.expireAt')}: {new Date(myPackage.expireAt).toLocaleString()}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t('packages.traffic')}</p>
                  <p className="text-sm font-medium">
                    {formatBytes(myPackage.trafficUsed)} / {formatBytes(myPackage.trafficQuota)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t('packages.requests')}</p>
                  <p className="text-sm font-medium">
                    {formatCount(myPackage.requestUsed)} / {formatCount(myPackage.requestQuota)}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t('packages.domains')}</p>
                  <p className="text-sm font-medium">{myPackage.domainLimit}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t('packages.bandwidth')}</p>
                  <p className="text-sm font-medium">{formatBandwidth(myPackage.bandwidthLimit)}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">{t('packages.noPackageHint')}</p>
              <Badge variant="secondary">{t('packages.noPackage')}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 筛选 */}
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
          <Button
            variant="ghost"
            onClick={() => {
              setKeyword('')
              setAppliedKeyword('')
              setPage(1)
            }}
          >
            {t('common.reset')}
          </Button>
        </CardContent>
      </Card>

      {/* 套餐列表 */}
      {isLoading ? (
        <Loading />
      ) : !data || data.list.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title={t('common.noData')} />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.list.map((pkg) => {
              const flags = parseFeatureFlags(pkg.featureFlags)
              return (
                <Card key={pkg.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle>{pkg.name}</CardTitle>
                      <Badge variant="outline">
                        {t('packages.accessType')}{' '}
                        {PACKAGE_ACCESS_TYPE_MAP[pkg.accessType as PackageAccessType] ?? '-'}
                      </Badge>
                    </div>
                    {pkg.description ? (
                      <p className="text-xs text-muted-foreground">{pkg.description}</p>
                    ) : null}
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col justify-between gap-4">
                    <div className="space-y-2">
                      <p className="text-2xl font-semibold text-primary">
                        ¥ {pkg.price}
                        <span className="ml-1 text-sm font-normal text-muted-foreground">
                          / {PACKAGE_PERIOD_MAP[pkg.period as PackagePeriod] ?? '-'}
                        </span>
                      </p>
                      <ul className="space-y-1 text-sm text-muted-foreground">
                        <li>
                          {t('packages.traffic')}: {formatBytes(pkg.trafficQuota)}
                        </li>
                        <li>
                          {t('packages.bandwidth')}: {formatBandwidth(pkg.bandwidthLimit)}
                        </li>
                        <li>
                          {t('packages.domains')}: {pkg.domainLimit}
                        </li>
                        <li>
                          {t('packages.requests')}: {formatCount(pkg.requestQuota)}
                        </li>
                      </ul>
                      {flags.length > 0 ? (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {flags.map((flag) => (
                            <Badge key={flag} variant="secondary">
                              {t(`packages.feature.${flag}`)}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <Button className="w-full" onClick={() => setBuyTarget(pkg)}>
                      <ShoppingCart className="h-4 w-4" />
                      {t('packages.buyNow')}
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          <Pagination
            page={data.pagination.page}
            pageSize={data.pagination.pageSize}
            total={data.pagination.total}
            onPageChange={setPage}
          />
        </>
      )}

      {/* 购买套餐 */}
      <Dialog open={buyTarget !== null} onOpenChange={() => setBuyTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('packages.buyTitle')}</DialogTitle>
            <DialogDescription>{buyTarget?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{t('packages.quantity')}</Label>
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuyTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={buyMutation.isPending || (Number(quantity) || 0) < 1}
              onClick={() => buyMutation.mutate()}
            >
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
