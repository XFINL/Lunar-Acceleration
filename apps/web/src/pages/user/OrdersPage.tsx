import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CreditCard, Eye } from 'lucide-react'
import { toast } from 'sonner'
import {
  ORDER_STATUS_MAP,
  OrderStatus,
  PAY_CHANNEL_MAP,
  PAY_CHANNELS,
  PaymentStatus,
  type PayChannel,
} from '@lunar/shared'
import { orderApi } from '@/api/order'
import type { OrderVo } from '@/api/types'
import { ApiError } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
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
const QUERY_KEY = ['user', 'orders']

const STATUS_OPTIONS = [
  OrderStatus.PENDING,
  OrderStatus.PAID,
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
]

const STATUS_VARIANT: Record<number, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  [OrderStatus.PENDING]: 'warning',
  [OrderStatus.PAID]: 'success',
  [OrderStatus.CANCELLED]: 'secondary',
  [OrderStatus.REFUNDED]: 'destructive',
}

const PAYMENT_STATUS_KEY: Record<number, string> = {
  [PaymentStatus.PENDING]: 'payStatus.pending',
  [PaymentStatus.SUCCESS]: 'payStatus.success',
  [PaymentStatus.FAILED]: 'payStatus.failed',
  [PaymentStatus.REFUNDED]: 'payStatus.refunded',
}

export function OrdersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [payTarget, setPayTarget] = useState<OrderVo | null>(null)
  const [channel, setChannel] = useState<PayChannel>('wechat')
  const [cancelTarget, setCancelTarget] = useState<OrderVo | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: [...QUERY_KEY, page, statusFilter],
    queryFn: () =>
      orderApi.listOrders({
        page,
        pageSize: PAGE_SIZE,
        status: statusFilter === '' ? undefined : Number(statusFilter),
      }),
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: [...QUERY_KEY, 'detail', detailId],
    queryFn: () => orderApi.getOrder(detailId as string),
    enabled: detailId !== null,
  })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY })

  const onError = (error: unknown) =>
    toast.error(error instanceof ApiError ? error.message : t('common.failed'))

  const payMutation = useMutation({
    mutationFn: () => {
      if (!payTarget) throw new Error('no target')
      return orderApi.payOrder(payTarget.id, channel)
    },
    onSuccess: () => {
      toast.success(t('orders.paySuccess'))
      setPayTarget(null)
      invalidate()
    },
    onError,
  })

  const cancelMutation = useMutation({
    mutationFn: () => {
      if (!cancelTarget) throw new Error('no target')
      return orderApi.cancelOrder(cancelTarget.id)
    },
    onSuccess: () => {
      toast.success(t('orders.cancelled'))
      setCancelTarget(null)
      invalidate()
    },
    onError,
  })

  return (
    <div className="page-stack">
      <PageHeader title={t('orders.title')} description={t('orders.desc')} />

      <Card>
        <CardContent className="filter-toolbar p-4 md:p-6">
          <SelectRoot value={statusFilter || "__radix_select_empty__"} onValueChange={(event) => {
              setPage(1)
              setStatusFilter(event === "__radix_select_empty__" ? '' : event)
            }}><SelectTrigger id="orderspage-select-1" className="w-[10rem]" aria-label={t('orders.status')}><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="__radix_select_empty__">{t('orders.status')}: {t('common.all')}</SelectItem>
            {STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={String(status)}>
                {ORDER_STATUS_MAP[status]}
              </SelectItem>
            ))}
          </SelectContent></SelectRoot>
          <Button
            variant="ghost"
            onClick={() => {
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
                    <TableHead>{t('orders.orderNo')}</TableHead>
                    <TableHead>{t('orders.packageName')}</TableHead>
                    <TableHead>{t('orders.amount')}</TableHead>
                    <TableHead>{t('orders.status')}</TableHead>
                    <TableHead>{t('common.createdAt')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.list.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-xs">{order.orderNo}</TableCell>
                      <TableCell>{order.packageName ?? '-'}</TableCell>
                      <TableCell>¥ {order.amount}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[order.status] ?? 'secondary'}>
                          {ORDER_STATUS_MAP[order.status as OrderStatus] ?? '-'}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(order.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="data-actions">
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('orders.detail')}
                            onClick={() => setDetailId(order.id)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {order.status === OrderStatus.PENDING ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('orders.pay')}
                                onClick={() => {
                                  setChannel('wechat')
                                  setPayTarget(order)
                                }}
                              >
                                <CreditCard className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('orders.cancel')}
                                onClick={() => setCancelTarget(order)}
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : null}
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

      {/* 订单详情 */}
      <Dialog open={detailId !== null} onOpenChange={() => setDetailId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('orders.detail')}</DialogTitle>
            <DialogDescription>{detail?.orderNo}</DialogDescription>
          </DialogHeader>
          {detailLoading || !detail ? (
            <Loading />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p>
                  <span className="text-muted-foreground">{t('orders.packageName')}: </span>
                  {detail.packageName ?? '-'}
                </p>
                <p>
                  <span className="text-muted-foreground">{t('orders.status')}: </span>
                  {ORDER_STATUS_MAP[detail.status as OrderStatus] ?? '-'}
                </p>
                <p>
                  <span className="text-muted-foreground">{t('orders.amount')}: </span>¥{' '}
                  {detail.amount}
                </p>
                <p>
                  <span className="text-muted-foreground">{t('orders.discount')}: </span>¥{' '}
                  {detail.discount}
                </p>
                <p>
                  <span className="text-muted-foreground">{t('orders.finalAmount')}: </span>¥{' '}
                  {detail.finalAmount}
                </p>
                <p>
                  <span className="text-muted-foreground">{t('orders.payChannel')}: </span>
                  {detail.payChannel
                    ? PAY_CHANNEL_MAP[detail.payChannel as PayChannel] ?? detail.payChannel
                    : '-'}
                </p>
                <p>
                  <span className="text-muted-foreground">{t('orders.payAt')}: </span>
                  {detail.payAt ? new Date(detail.payAt).toLocaleString() : '-'}
                </p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">{t('orders.items')}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('orders.itemName')}</TableHead>
                      <TableHead>{t('orders.itemPrice')}</TableHead>
                      <TableHead>{t('orders.itemQuantity')}</TableHead>
                      <TableHead>{t('orders.itemSubtotal')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.name}</TableCell>
                        <TableCell>¥ {item.price}</TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>¥ {item.subtotal}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">{t('orders.payments')}</p>
                {detail.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('common.noData')}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('orders.channel')}</TableHead>
                        <TableHead>{t('orders.amount')}</TableHead>
                        <TableHead>{t('orders.paymentStatus')}</TableHead>
                        <TableHead>{t('orders.tradeNo')}</TableHead>
                        <TableHead>{t('common.createdAt')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.payments.map((payment) => (
                        <TableRow key={payment.id}>
                          <TableCell>
                            {PAY_CHANNEL_MAP[payment.channel as PayChannel] ?? payment.channel}
                          </TableCell>
                          <TableCell>¥ {payment.amount}</TableCell>
                          <TableCell>
                            {t(PAYMENT_STATUS_KEY[payment.status] ?? 'payStatus.pending')}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {payment.tradeNo ?? '-'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {new Date(payment.createdAt).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailId(null)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 支付 */}
      <Dialog open={payTarget !== null} onOpenChange={() => setPayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('orders.pay')}</DialogTitle>
            <DialogDescription>{payTarget?.orderNo}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="form-field">
              <Label htmlFor="orderspage-select-2">{t('orders.chooseChannel')}</Label>
              <SelectRoot value={channel} onValueChange={(event) => setChannel(event as PayChannel)}><SelectTrigger id="orderspage-select-2" aria-label={t('orders.chooseChannel')}><SelectValue /></SelectTrigger><SelectContent>
                {PAY_CHANNELS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {PAY_CHANNEL_MAP[item]}
                  </SelectItem>
                ))}
              </SelectContent></SelectRoot>
            </div>
            <p className="text-xs text-muted-foreground">{t('orders.mockPayHint')}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={payMutation.isPending} onClick={() => payMutation.mutate()}>
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 取消订单 */}
      <Dialog open={cancelTarget !== null} onOpenChange={() => setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('orders.cancel')}</DialogTitle>
            <DialogDescription>{t('orders.cancelConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              {t('common.back')}
            </Button>
            <Button
              variant="destructive"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
