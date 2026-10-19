import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { cn } from '@/lib/utils'
export interface ScrollAreaProps extends React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  viewportClassName?: string
  orientation?: 'vertical' | 'horizontal' | 'both'
  viewportRef?: React.Ref<HTMLDivElement>
  viewportProps?: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Viewport>
}
const ScrollArea = React.forwardRef<React.ElementRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(({ children, className, viewportClassName, orientation = 'vertical', viewportRef, viewportProps, ...rootProps }, ref) => {
  const { className: viewportPropsClassName, tabIndex, 'aria-label': ariaLabel, ...restViewportProps } = viewportProps ?? {}
  return <ScrollAreaPrimitive.Root ref={ref} className={cn('relative min-w-0 overflow-hidden', className)} {...rootProps}>
    <ScrollAreaPrimitive.Viewport ref={viewportRef} tabIndex={tabIndex ?? 0} aria-label={ariaLabel ?? 'Scrollable content'} className={cn('h-full w-full min-w-0 rounded-[inherit] focus-visible:outline-none', viewportPropsClassName, viewportClassName)} {...restViewportProps} disableImplicitContentElement>
      <ScrollAreaPrimitive.Content className="min-w-0 w-full" style={{ display: 'block', minWidth: 0 }}>{children}</ScrollAreaPrimitive.Content>
    </ScrollAreaPrimitive.Viewport>
    {(orientation === 'vertical' || orientation === 'both') && <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="scroll-area-scrollbar scroll-area-scrollbar-vertical"><ScrollAreaPrimitive.Thumb className="scroll-area-thumb" /></ScrollAreaPrimitive.Scrollbar>}
    {(orientation === 'horizontal' || orientation === 'both') && <ScrollAreaPrimitive.Scrollbar orientation="horizontal" className="scroll-area-scrollbar scroll-area-scrollbar-horizontal"><ScrollAreaPrimitive.Thumb className="scroll-area-thumb" /></ScrollAreaPrimitive.Scrollbar>}
    <ScrollAreaPrimitive.Corner className="scroll-area-corner" />
  </ScrollAreaPrimitive.Root>
})
ScrollArea.displayName = 'ScrollArea'
export { ScrollArea }
