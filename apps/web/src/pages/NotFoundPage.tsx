import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-5xl font-bold leading-none tabular-nums text-foreground">404</h1>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{t('common.noData')}</p>
      <Link to="/" className={cn(buttonVariants({ variant: 'default' }))}>
        {t('common.back')}
      </Link>
    </div>
  )
}
