import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="page-header mb-6 flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 flex-1 space-y-2">
        <h1 className="break-words text-page-title tracking-tight">{title}</h1>
        {description ? <p className="page-header-description break-words text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2 md:shrink-0 md:justify-end">{actions}</div> : null}
    </div>
  )
}
