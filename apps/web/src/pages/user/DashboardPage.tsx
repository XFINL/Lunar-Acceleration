import { useTranslation } from 'react-i18next'
import {
  ArrowUpRight,
  BarChart3,
  CreditCard,
  Gauge,
  Globe,
  LifeBuoy,
  Wallet,
  Zap,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/common/PageHeader'
import { useAuthStore } from '@/stores/auth'

interface StatCard {
  labelKey: string
  value: string
  icon: typeof Gauge
  hint?: string
}

export function DashboardPage() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)

  const stats: StatCard[] = [
    { labelKey: 'dashboard.traffic', value: '—', icon: Zap },
    { labelKey: 'dashboard.bandwidth', value: '—', icon: Gauge },
    { labelKey: 'dashboard.requests', value: '—', icon: BarChart3 },
    { labelKey: 'dashboard.hitRate', value: '—', icon: Globe },
  ]

  return (
    <div>
      <PageHeader
        title={t('dashboard.welcome', { name: user?.nickname ?? user?.username ?? '' })}
        description={t('app.tagline')}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.labelKey}>
              <CardContent className="flex items-center justify-between p-5">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{t(stat.labelKey)}</p>
                  <p className="text-xl font-semibold">{stat.value}</p>
                </div>
                <span className="rounded-lg bg-primary/10 p-2 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              {t('dashboard.balance')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">¥ {user?.balance ?? '0.00'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-primary" />
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
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              {t('dashboard.totalDomains')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">0</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-primary" />
            {t('dashboard.comingSoon')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">{t('dashboard.comingSoonDesc')}</p>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        </CardContent>
      </Card>
    </div>
  )
}
