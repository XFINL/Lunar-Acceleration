import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Rocket, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NavGroup } from '../types'

interface SidebarProps {
  groups: NavGroup[]
  open: boolean
  onClose: () => void
}

export function Sidebar({ groups, open, onClose }: SidebarProps) {
  const { t } = useTranslation()

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onClose} aria-hidden />
      ) : null}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r bg-card transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Rocket className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold">{t('app.name')}</span>
          </div>
          <button
            type="button"
            className="text-muted-foreground lg:hidden"
            onClick={onClose}
            aria-label="close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group.titleKey} className="space-y-1">
              <p className="px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t(group.titleKey)}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon
                if (item.comingSoon) {
                  return (
                    <div
                      key={item.to}
                      className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/60"
                      title={t('dashboard.comingSoon')}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="flex-1 truncate">{t(item.labelKey)}</span>
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                    </div>
                  )
                }
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/' || item.to === '/admin'}
                    onClick={onClose}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                        isActive
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="h-4 w-4" />
                    <span className="truncate">{t(item.labelKey)}</span>
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}
