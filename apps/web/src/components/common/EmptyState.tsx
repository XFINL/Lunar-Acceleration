import type { ReactNode } from 'react'

export function EmptyState({ title, description, action }: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center gap-4 px-4 py-12 text-center md:px-6">
      <div className="min-w-0 max-w-md space-y-2">
        <p className="text-base font-medium leading-6">{title}</p>
        {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  )
}
