import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'

interface ConfirmActionProps {
  children: ReactElement
  description: string
  onConfirm: () => void
  title?: string
}

/** Official shadcn composition; Radix retains safe initial focus on Cancel. */
export function ConfirmAction({ children, description, onConfirm, title }: ConfirmActionProps) {
  const { t } = useTranslation()
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title ?? t('common.confirm')}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild><Button variant="outline">{t('common.cancel')}</Button></AlertDialogCancel>
          <AlertDialogAction asChild><Button onClick={onConfirm}>{t('common.confirm')}</Button></AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
