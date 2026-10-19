import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/common/PageHeader'
import { useAuthStore } from '@/stores/auth'

interface StatCard {
  labelKey: string
  value: string
  hint?: string
}

export function DashboardPage() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)

  const stats: StatCard[] = [
    { labelKey: 'dashboard.traffic', value: '—' },
    { labelKey: 'dashboard.bandwidth', value: '—' },
    { labelKey: 'dashboard.requests', value: '—' },
    { labelKey: 'dashboard.hitRate', value: '—' },
  ]

  return (
    <div className="page-stack">
      <PageHeader
        title={t('dashboard.welcome', { name: user?.nickname ?? user?.username ?? '' })}
        description={t('app.tagline')}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
            <Card key={stat.labelKey}>
              <CardContent className="flex items-center justify-between p-5">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t(stat.labelKey)}</p>
                  <p className="text-xl font-semibold">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          )
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>

              {t('dashboard.balance')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="numeric text-2xl font-semibold">¥ {user?.balance ?? '0.00'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>

              {t('dashboard.package')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Badge variant="secondary">{t('dashboard.noPackage')}</Badge>
            <p className="text-xs text-muted-foreground">
              {t('dashboard.packageExpire')}: —
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>

              {t('dashboard.totalDomains')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">0</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>

            {t('dashboard.comingSoon')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">{t('dashboard.comingSoonDesc')}</p>

        </CardContent>
      </Card>
    </div>
  )
}
