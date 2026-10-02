import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { userApi } from '@/api/user'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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

const PAGE_SIZE = 20

export function LoginLogsPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['user', 'login-logs', page],
    queryFn: () => userApi.loginLogs({ page, pageSize: PAGE_SIZE }),
  })

  return (
    <div>
      <PageHeader title={t('user.loginLogs')} description={t('user.loginLogsDesc')} />

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
                    <TableHead>{t('user.time')}</TableHead>
                    <TableHead>{t('user.ip')}</TableHead>
                    <TableHead>{t('user.location')}</TableHead>
                    <TableHead>{t('user.userAgent')}</TableHead>
                    <TableHead>{t('user.result')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.list.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.ip}</TableCell>
                      <TableCell className="text-xs">{item.region ?? '-'}</TableCell>
                      <TableCell
                        className="max-w-xs truncate text-xs text-muted-foreground"
                        title={item.ua ?? ''}
                      >
                        {item.ua ?? '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.status === 1 ? 'success' : 'destructive'}>
                          {item.status === 1
                            ? t('user.loginSuccessFlag')
                            : t('user.loginFailFlag')}
                        </Badge>
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
    </div>
  )
}
