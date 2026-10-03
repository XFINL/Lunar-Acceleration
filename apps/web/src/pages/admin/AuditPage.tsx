import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/api/admin'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
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
const MODULES = ['user', 'rbac']

export function AuditPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [module, setModule] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit-logs', page, module],
    queryFn: () =>
      adminApi.listAuditLogs({ page, pageSize: PAGE_SIZE, module: module || undefined }),
  })

  return (
    <div>
      <PageHeader
        title={t('admin.audit')}
        description={t('admin.auditDesc')}
        actions={
          <Select
            className="w-40"
            value={module}
            onChange={(event) => {
              setModule(event.target.value)
              setPage(1)
            }}
          >
            <option value="">{t('admin.moduleAll')}</option>
            {MODULES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        }
      />

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
                    <TableHead>{t('common.createdAt')}</TableHead>
                    <TableHead>{t('admin.module')}</TableHead>
                    <TableHead>{t('admin.action')}</TableHead>
                    <TableHead>{t('admin.target')}</TableHead>
                    <TableHead>{t('admin.operator')}</TableHead>
                    <TableHead>{t('user.ip')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.list.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(item.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{item.module}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.action}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.targetType ? `${item.targetType}#${item.targetId ?? '-'}` : '-'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.userId ?? '-'}</TableCell>
                      <TableCell className="font-mono text-xs">{item.ip ?? '-'}</TableCell>
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
