import * as React from 'react'
import { cn } from '@/lib/utils'
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn('frosted-control flex min-h-24 w-full resize-y rounded-xl px-3 py-2 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm', className)} {...props} />
))
Textarea.displayName = 'Textarea'
export { Textarea }
