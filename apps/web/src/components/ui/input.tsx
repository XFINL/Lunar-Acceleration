import * as React from 'react'
import { cn } from '@/lib/utils'
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(({ className, type, ...props }, ref) => (
  <input ref={ref} type={type} className={cn('frosted-control flex h-[var(--control-height)] w-full min-w-0 rounded-xl px-3 py-1 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm', className)} {...props} />
))
Input.displayName = 'Input'
export { Input }
