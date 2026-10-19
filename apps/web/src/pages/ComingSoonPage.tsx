import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/common/PageHeader'

export function ComingSoonPage() {
  const { t } = useTranslation()
  return (
    <div className="page-stack">
      <PageHeader title={t('dashboard.comingSoon')} />
      <Card>
        <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{t('dashboard.comingSoonDesc')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
