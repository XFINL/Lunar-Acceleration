import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { cn } from '@/lib/utils'
const AlertDialog = AlertDialogPrimitive.Root
const AlertDialogTrigger = AlertDialogPrimitive.Trigger
const AlertDialogPortal = AlertDialogPrimitive.Portal
const AlertDialogOverlay = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>>(({ className, ...props }, ref) => <AlertDialogPrimitive.Overlay ref={ref} className={cn('fixed inset-0 z-50 bg-black/50', className)} {...props} />)
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName
const AlertDialogContent = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Content>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>>(({ className, ...props }, ref) => <AlertDialogPortal><AlertDialogOverlay /><AlertDialogPrimitive.Content ref={ref} className={cn('frosted-popover fixed left-1/2 top-1/2 z-50 grid w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-3xl p-4 text-base shadow-xl focus:outline-none md:p-6 md:text-sm', className)} {...props} /></AlertDialogPortal>)
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName
const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col gap-2 text-center sm:text-left', className)} {...props} />
const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
const AlertDialogTitle = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>>(({ className, ...props }, ref) => <AlertDialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props} />)
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName
const AlertDialogDescription = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>>(({ className, ...props }, ref) => <AlertDialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />)
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName
const AlertDialogAction = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Action>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>>(({ className, ...props }, ref) => <AlertDialogPrimitive.Action ref={ref} className={cn('inline-flex h-[var(--control-height)] items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50', className)} {...props} />)
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName
const AlertDialogCancel = React.forwardRef<React.ElementRef<typeof AlertDialogPrimitive.Cancel>, React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>>(({ className, ...props }, ref) => <AlertDialogPrimitive.Cancel ref={ref} className={cn('frosted-control inline-flex h-[var(--control-height)] items-center justify-center rounded-xl border border-input px-4 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50', className)} {...props} />)
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName
export { AlertDialog, AlertDialog as AlertDialogRoot, AlertDialogTrigger, AlertDialogPortal, AlertDialogOverlay, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel }
