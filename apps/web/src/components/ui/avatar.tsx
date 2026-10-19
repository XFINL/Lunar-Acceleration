import * as React from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import { cn } from '@/lib/utils'

export interface AvatarProps extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> {
  name?: string | null
  src?: string | null
}
const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ className, name, src, children, 'aria-label': ariaLabel, ...props }, ref) => {
    const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?'
    const accessibleName = (ariaLabel ?? name?.trim()) || 'avatar'
    return (
      <AvatarPrimitive.Root ref={ref} role="img" aria-label={accessibleName} className={cn('relative flex h-9 w-9 shrink-0 overflow-hidden rounded-full', className)} {...props}>
        {children ?? <>
          {src ? <AvatarPrimitive.Image src={src} alt="" className="aspect-square h-full w-full object-cover" /> : null}
          <AvatarPrimitive.Fallback delayMs={src ? 150 : undefined} className="flex h-full w-full items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">{initial}</AvatarPrimitive.Fallback>
        </>}
      </AvatarPrimitive.Root>
    )
  },
)
Avatar.displayName = AvatarPrimitive.Root.displayName
const AvatarImage = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Image>, React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image ref={ref} className={cn('aspect-square h-full w-full object-cover', className)} {...props} />
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName
const AvatarFallback = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Fallback>, React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback ref={ref} className={cn('flex h-full w-full items-center justify-center rounded-full bg-muted text-sm font-medium', className)} {...props} />
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName
export { Avatar, AvatarImage, AvatarFallback }
