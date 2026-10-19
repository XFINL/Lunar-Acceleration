import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  ORDER_STATUS_MAP,
  OrderStatus,
  PAY_CHANNEL_MAP,
  PaymentStatus,
  TRANSACTION_TYPE_MAP,
  TransactionType,
  type PayChannel,
} from '@lunar/shared'
import { adminApi } from '@/api/admin'
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
import { Input } from '@/components/ui/input'
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs } from '@/components/ui/tabs'
import { EmptyState } from '@/components/common/EmptyState'
import { Loading } from '@/components/common/Loading'
import { PageHeader } from '@/components/common/PageHeader'
import { ConfirmAction } from '@/components/common/ConfirmAction'
import { Pagination } from '@/components/common/Pagination'

const PAGE_SIZE = 10

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

export function AdminOrdersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [tab, setTab] = useState('orders')
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [txPage, setTxPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'orders', page, appliedKeyword, statusFilter],
    queryFn: () =>
      adminApi.listOrders({
        page,
        pageSize: PAGE_SIZE,
        keyword: appliedKeyword || undefined,
        status: statusFilter === '' ? undefined : Number(statusFilter),
      }),
  })

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['admin', 'orders', 'detail', detailId],
    queryFn: () => adminApi.getOrder(detailId as string),
    enabled: detailId !== null,
  })

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['admin', 'transactions', txPage],
    queryFn: () => adminApi.listTransactions({ page: txPage, pageSize: PAGE_SIZE }),
    enabled: tab === 'transactions',
  })

  const onError = (error: unknown) =>
    toast.error(error instanceof ApiError ? error.message : t('common.failed'))

  const refundMutation = useMutation({
    mutationFn: (id: string) => adminApi.refundOrder(id),
    onSuccess: () => {
      toast.success(t('orders.refundSuccess'))
      void queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
    },
    onError,
  })

  const renderOrders = () => {
    if (isLoading) return <Loading />
    if (!data || data.list.length === 0) return <EmptyState title={t('common.noData')} />
    return (
      <>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('orders.orderNo')}</TableHead>
              <TableHead>{t('admin.user')}</TableHead>
              <TableHead>{t('orders.packageName')}</TableHead>
              <TableHead>{t('orders.finalAmount')}</TableHead>
              <TableHead>{t('orders.status')}</TableHead>
              <TableHead>{t('common.createdAt')}</TableHead>
              <TableHead className="text-right">{t('common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.list.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-mono text-xs">{order.orderNo}</TableCell>
                <TableCell>{order.username}</TableCell>
                <TableCell>{order.packageName ?? '-'}</TableCell>
                <TableCell className="numeric whitespace-nowrap">¥ {order.finalAmount}</TableCell>
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
                    {order.status === OrderStatus.PAID ? (
                      <ConfirmAction
                        title={t('admin.refund')}
                        description={t('admin.refundConfirm')}
                        onConfirm={() => refundMutation.mutate(order.id)}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={refundMutation.isPending}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {t('admin.refund')}
                        </Button>
                      </ConfirmAction>
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
    )
  }

  const renderTransactions = () => {
    if (txLoading) return <Loading />
    if (!transactions || transactions.list.length === 0)
      return <EmptyState title={t('common.noData')} />
    return (
      <>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common.createdAt')}</TableHead>
              <TableHead>{t('admin.user')}</TableHead>
              <TableHead>{t('admin.transactionType')}</TableHead>
              <TableHead>{t('orders.amount')}</TableHead>
              <TableHead>{t('admin.balanceAfter')}</TableHead>
              <TableHead>{t('admin.remark')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.list.map((tx) => (
              <TableRow key={tx.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(tx.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>{tx.username}</TableCell>
                <TableCell>
                  <Badge variant={tx.type === TransactionType.INCOME ? 'success' : 'warning'}>
                    {TRANSACTION_TYPE_MAP[tx.type as TransactionType] ?? '-'}
                  </Badge>
                </TableCell>
                <TableCell className="numeric whitespace-nowrap">¥ {tx.amount}</TableCell>
                <TableCell className="numeric whitespace-nowrap">¥ {tx.balanceAfter}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {tx.remark ?? (tx.refType ? `${tx.refType}#${tx.refId ?? '-'}` : '-')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="px-4 pb-4">
          <Pagination
            page={transactions.pagination.page}
            pageSize={transactions.pagination.pageSize}
            total={transactions.pagination.total}
            onPageChange={setTxPage}
          />
        </div>
      </>
    )
  }

  return (
    <div className="page-stack">
      <PageHeader title={t('admin.orders')} description={t('admin.ordersDesc')} />

      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'orders', label: t('admin.orders') },
          { value: 'transactions', label: t('admin.transactions') },
        ]}
      />

      {tab === 'orders' ? (
        <div className="page-stack">
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
                }}><SelectTrigger id="adminorderspage-select-1" className="w-[10rem]" aria-label={t('orders.status')}><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="__radix_select_empty__">
                  {t('orders.status')}: {t('common.all')}
                </SelectItem>
                {STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={String(status)}>
                    {ORDER_STATUS_MAP[status]}
                  </SelectItem>
                ))}
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
            <CardContent className="p-0">{renderOrders()}</CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">{renderTransactions()}</CardContent>
        </Card>
      )}

      {/* 订单详情 */}
      <Dialog open={detailId !== null} onOpenChange={() => setDetailId(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('admin.orderDetail')}</DialogTitle>
            <DialogDescription>{detail?.orderNo}</DialogDescription>
          </DialogHeader>
          {detailLoading || !detail ? (
            <Loading />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p>
                  <span className="text-muted-foreground">{t('admin.user')}: </span>
                  {detail.user.username}
                </p>
                <p>
                  <span className="text-muted-foreground">{t('orders.status')}: </span>
                  {ORDER_STATUS_MAP[detail.status as OrderStatus] ?? '-'}
                </p>
                <p>
                  <span className="text-muted-foreground">{t('orders.packageName')}: </span>
                  {detail.packageName ?? '-'}
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

              <div className="space-y-2">
                <p className="text-sm font-medium">{t('orders.items')}</p>
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

              <div className="space-y-2">
                <p className="text-sm font-medium">{t('orders.payments')}</p>
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
          <DialogFooter className="form-actions">
            <Button variant="outline" onClick={() => setDetailId(null)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
