import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export function Loading({ className, label }: { className?: string; label?: string }) {
  const { t } = useTranslation()
  return (
    <div className={cn('flex items-center justify-center gap-2 py-10 text-muted-foreground', className)}>
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">{label ?? t('common.loading')}</span>
    </div>
  )
}

export function FullPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loading />
    </div>
  )
}
