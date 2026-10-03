import { useTranslation } from 'react-i18next'
import { UserStatus } from '@lunar/shared'
import { Badge } from '@/components/ui/badge'

const VARIANT_MAP: Record<number, 'success' | 'destructive' | 'warning'> = {
  [UserStatus.ACTIVE]: 'success',
  [UserStatus.DISABLED]: 'destructive',
  [UserStatus.PENDING]: 'warning',
}

const LABEL_KEY: Record<number, string> = {
  [UserStatus.ACTIVE]: 'status.active',
  [UserStatus.DISABLED]: 'status.disabled',
  [UserStatus.PENDING]: 'status.pending',
}

export function StatusBadge({ status }: { status: number }) {
  const { t } = useTranslation()
  return (
    <Badge variant={VARIANT_MAP[status] ?? 'secondary'}>
      {t(LABEL_KEY[status] ?? 'status.pending')}
    </Badge>
  )
}
