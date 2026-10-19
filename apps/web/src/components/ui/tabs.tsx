import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'
const TabsRoot = TabsPrimitive.Root
const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn('frosted-control inline-flex h-auto max-w-full items-center justify-start gap-1 overflow-x-auto rounded-xl p-1', className)} {...props} />
))
TabsList.displayName = TabsPrimitive.List.displayName
const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger ref={ref} className={cn('inline-flex h-[var(--control-height)] shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-secondary data-[state=active]:text-secondary-foreground data-[state=active]:shadow-sm', className)} {...props} />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName
const TabsContent = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)} {...props} />
))
TabsContent.displayName = TabsPrimitive.Content.displayName
interface TabsItem { value: string; label: React.ReactNode }
interface TabsProps extends Omit<React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>, 'value' | 'onValueChange' | 'defaultValue' | 'children'> { value: string; onValueChange: (value: string) => void; items: TabsItem[]; className?: string }
function Tabs({ value, onValueChange, items, className, ...props }: TabsProps) {
  return <TabsRoot value={value} onValueChange={onValueChange} {...props}><TabsList className={className}>{items.map((item) => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}</TabsList></TabsRoot>
}
export { Tabs, TabsRoot, TabsList, TabsTrigger, TabsContent }
