import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/api/admin'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/common/PageHeader'

export function AdminDashboardPage() {
  const { t } = useTranslation()

  const { data } = useQuery({
    queryKey: ['admin', 'users', 'count'],
    queryFn: () => adminApi.listUsers({ page: 1, pageSize: 1 }),
  })

  const cards = [
    { labelKey: 'dashboard.totalUsers', value: data?.pagination.total ?? '—' },
    { labelKey: 'dashboard.totalNodes', value: '—' },
    { labelKey: 'dashboard.pendingAudit', value: '—' },
    { labelKey: 'dashboard.totalRevenue', value: '—' },
  ]

  return (
    <div className="page-stack">
      <PageHeader title={t('dashboard.adminOverview')} description={t('app.tagline')} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          return (
            <Card key={card.labelKey}>
              <CardContent className="p-4 md:p-6">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t(card.labelKey)}</p>
                  <p className="numeric text-xl font-semibold">{card.value}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
