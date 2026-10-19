import * as React from 'react'
import { cn } from '@/lib/utils'

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('frosted-panel min-w-0 rounded-3xl border border-border/60 text-card-foreground shadow-sm', className)} {...props} />
))
Card.displayName = 'Card'
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex min-w-0 flex-col gap-2 p-[var(--panel-padding)]', className)} {...props} />
))
CardHeader.displayName = 'CardHeader'
const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn('text-base font-semibold leading-6 tracking-tight', className)} {...props} />
))
CardTitle.displayName = 'CardTitle'
const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
))
CardDescription.displayName = 'CardDescription'
const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('min-w-0 p-[var(--panel-padding)]', className)} {...props} />
))
CardContent.displayName = 'CardContent'
const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center p-[var(--panel-padding)] pt-0', className)} {...props} />
))
CardFooter.displayName = 'CardFooter'
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
