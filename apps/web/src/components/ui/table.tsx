import { forwardRef, type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'

export const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  ({ className, 'aria-label': ariaLabel, ...props }, ref) => (
    <ScrollArea
      orientation="horizontal"
      className="relative w-full min-w-0 overflow-hidden"
      viewportClassName="min-w-0 max-w-full"
      viewportProps={{ 'aria-label': ariaLabel ? `Scrollable table: ${ariaLabel}` : 'Scrollable table' }}
    >
      <table
        ref={ref}
        aria-label={ariaLabel}
        className={cn('w-full min-w-full caption-bottom text-sm tabular-nums', className)}
        {...props}
      />
    </ScrollArea>
  ),
)
Table.displayName = 'Table'

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
))
TableHeader.displayName = 'TableHeader'

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
))
TableBody.displayName = 'TableBody'

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn('border-b transition-colors hover:bg-muted/50', className)}
      {...props}
    />
  ),
)
TableRow.displayName = 'TableRow'

export const TableHead = forwardRef<
  HTMLTableCellElement,
  ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-11 whitespace-nowrap px-4 py-3 text-left align-middle text-xs font-medium leading-5 text-muted-foreground',
      className,
    )}
    {...props}
  />
))
TableHead.displayName = 'TableHead'

export const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn('px-4 py-3 align-middle leading-6', className)} {...props} />
  ),
)
TableCell.displayName = 'TableCell'
