import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="text-5xl font-bold text-primary">404</p>
      <p className="text-sm text-muted-foreground">{t('common.noData')}</p>
      <Link to="/" className={cn(buttonVariants({ variant: 'default' }))}>
        {t('common.back')}
      </Link>
    </div>
  )
}
