import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Activity, Server, ShieldCheck, Users } from 'lucide-react'
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
    { labelKey: 'dashboard.totalUsers', value: data?.pagination.total ?? '—', icon: Users },
    { labelKey: 'dashboard.totalNodes', value: '—', icon: Server },
    { labelKey: 'dashboard.pendingAudit', value: '—', icon: ShieldCheck },
    { labelKey: 'dashboard.totalRevenue', value: '—', icon: Activity },
  ]

  return (
    <div>
      <PageHeader title={t('dashboard.adminOverview')} description={t('app.tagline')} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.labelKey}>
              <CardContent className="flex items-center justify-between p-5">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t(card.labelKey)}</p>
                  <p className="text-xl font-semibold">{card.value}</p>
                </div>
                <span className="rounded-lg bg-primary/10 p-2 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
