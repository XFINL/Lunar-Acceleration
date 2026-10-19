import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
const SelectRoot = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value
const SelectTrigger = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger ref={ref} className={cn('frosted-control flex h-[var(--control-height)] min-h-[var(--control-height)] w-full min-w-0 items-center justify-between gap-2 overflow-hidden rounded-xl px-3 py-0 text-base leading-5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm [&>span:first-child]:min-w-0 [&>span:first-child]:truncate', className)} {...props}>
    {children}<SelectPrimitive.Icon asChild><ChevronDown className="h-4 w-4 shrink-0 opacity-50" /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName
const SelectContent = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Content>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal><SelectPrimitive.Content ref={ref} position={position} sideOffset={4} collisionPadding={8} className={cn('frosted-popover z-[100] max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-2xl border border-border/70 text-popover-foreground shadow-xl', className)} {...props}>
    <SelectPrimitive.ScrollUpButton className="flex h-7 items-center justify-center text-muted-foreground"><ChevronUp className="h-4 w-4" /></SelectPrimitive.ScrollUpButton>
    <SelectPrimitive.Viewport className="max-h-[var(--radix-select-content-available-height)] p-1">{children}</SelectPrimitive.Viewport>
    <SelectPrimitive.ScrollDownButton className="flex h-7 items-center justify-center text-muted-foreground"><ChevronDown className="h-4 w-4" /></SelectPrimitive.ScrollDownButton>
  </SelectPrimitive.Content></SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName
const SelectLabel = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Label>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>>(({ className, ...props }, ref) => <SelectPrimitive.Label ref={ref} className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)} {...props} />)
SelectLabel.displayName = SelectPrimitive.Label.displayName
const SelectItem = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Item>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item ref={ref} className={cn('relative flex min-h-[var(--control-height)] w-full cursor-default select-none items-center rounded-xl py-2 pl-3 pr-9 text-base leading-5 outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 md:text-sm', className)} {...props}>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText><span className="absolute right-3 flex h-4 w-4 items-center justify-center"><SelectPrimitive.ItemIndicator><Check className="h-4 w-4" /></SelectPrimitive.ItemIndicator></span>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName
const SelectSeparator = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>>(({ className, ...props }, ref) => <SelectPrimitive.Separator ref={ref} className={cn('mx-1 my-1 h-px bg-border', className)} {...props} />)
SelectSeparator.displayName = SelectPrimitive.Separator.displayName
const SelectScrollUpButton = SelectPrimitive.ScrollUpButton
const SelectScrollDownButton = SelectPrimitive.ScrollDownButton
export { SelectRoot, SelectRoot as Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectLabel, SelectItem, SelectSeparator, SelectScrollUpButton, SelectScrollDownButton }
