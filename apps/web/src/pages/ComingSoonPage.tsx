import { useTranslation } from 'react-i18next'
import { Hammer } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/common/PageHeader'

export function ComingSoonPage() {
  const { t } = useTranslation()
  return (
    <div>
      <PageHeader title={t('dashboard.comingSoon')} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="rounded-full bg-primary/10 p-3 text-primary">
            <Hammer className="h-5 w-5" />
          </span>
          <p className="text-sm text-muted-foreground">{t('dashboard.comingSoonDesc')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
