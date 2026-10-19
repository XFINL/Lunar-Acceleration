import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const { t } = useTranslation()
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-2">
      <p className="min-w-0 text-sm leading-5 tabular-nums text-muted-foreground">
        {t('common.total', { count: total })} · <span aria-live="polite" aria-atomic="true">{page}/{totalPages}</span>
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-11 min-h-11 w-11 min-w-11 rounded-full p-0 md:h-9 md:min-h-9 md:w-9 md:min-w-9"
          disabled={page <= 1}
          aria-label={t('common.previousPage')}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-11 min-h-11 w-11 min-w-11 rounded-full p-0 md:h-9 md:min-h-9 md:w-9 md:min-w-9"
          disabled={page >= totalPages}
          aria-label={t('common.nextPage')}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
