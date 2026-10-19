import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
const badgeVariants = cva('inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', {
  variants: { variant: {
    default: 'bg-primary text-primary-foreground', secondary: 'bg-secondary text-secondary-foreground', destructive: 'bg-destructive text-destructive-foreground', outline: 'border-border text-foreground', success: 'border-border bg-secondary text-secondary-foreground', warning: 'border-border bg-muted text-muted-foreground',
  } }, defaultVariants: { variant: 'default' },
})
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}
function Badge({ className, variant, ...props }: BadgeProps) { return <span className={cn(badgeVariants({ variant }), className)} {...props} /> }
export { Badge, badgeVariants }
