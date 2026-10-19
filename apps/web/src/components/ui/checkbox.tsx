import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(({ className, checked, children, ...props }, ref) => (
  <CheckboxPrimitive.Root ref={ref} checked={checked} className={cn('frosted-control relative inline-grid h-5 w-5 shrink-0 place-items-center rounded-md border border-input align-middle text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary', className)} {...props}>
    {children ?? <CheckboxPrimitive.Indicator className="pointer-events-none relative z-10 flex items-center justify-center">{checked === 'indeterminate' ? <Minus className="h-3.5 w-3.5" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}</CheckboxPrimitive.Indicator>}
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName
export { Checkbox }
