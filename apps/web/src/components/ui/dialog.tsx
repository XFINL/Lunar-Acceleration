import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
type ControlledDialogProps = Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>, 'open' | 'onOpenChange'> & { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }
function Dialog({ open, onOpenChange, children, ...props }: ControlledDialogProps) { return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} {...props}>{children}</DialogPrimitive.Root> }
const DialogRoot = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close
function DialogOverlay({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) { return <DialogPrimitive.Overlay className={cn('fixed inset-0 z-50 bg-black/50', className)} {...props} /> }
function DialogContent({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  const { t } = useTranslation()
  const previouslyFocused = React.useRef<HTMLElement | null>(null)
  const { onOpenAutoFocus, onCloseAutoFocus, ...contentProps } = props
  return <DialogPortal><DialogOverlay /><DialogPrimitive.Content {...contentProps} className={cn('frosted-popover fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-3xl p-4 text-base shadow-xl focus:outline-none md:p-6 md:text-sm', className)} onOpenAutoFocus={(event) => { previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; onOpenAutoFocus?.(event) }} onCloseAutoFocus={(event) => { onCloseAutoFocus?.(event); if (event.defaultPrevented) return; const target = previouslyFocused.current; previouslyFocused.current = null; if (target?.isConnected) { event.preventDefault(); target.focus() } }}>
    <DialogPrimitive.Close aria-label={t('common.close')} className="absolute right-3 top-3 inline-flex h-[var(--control-height)] w-[var(--control-height)] items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" aria-hidden="true" /></DialogPrimitive.Close>{children}
  </DialogPrimitive.Content></DialogPortal>
}
function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn('mb-6 flex flex-col gap-2 pr-12', className)} {...props} /> }
function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} /> }
const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(({ className, ...props }, ref) => <DialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />)
DialogTitle.displayName = DialogPrimitive.Title.displayName
const DialogDescription = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(({ className, ...props }, ref) => <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />)
DialogDescription.displayName = DialogPrimitive.Description.displayName
export { Dialog, DialogRoot, DialogTrigger, DialogPortal, DialogClose, DialogOverlay, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription }
