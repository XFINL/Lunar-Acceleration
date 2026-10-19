import type { RefObject } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { GlassSurface } from '@/components/common/GlassSurface'
import { useSiteConfig } from '@/components/common/SiteConfigProvider'
import type { NavGroup } from '../types'

interface SidebarProps {
  groups: NavGroup[]
  open: boolean
  onClose: () => void
  triggerRef?: RefObject<HTMLButtonElement | null>
}

function NavigationContents({ groups, onClose, siteName, mobile = false }: Pick<SidebarProps, 'groups' | 'onClose'> & { siteName: string; mobile?: boolean }) {
  const { t } = useTranslation()
  const brand = <span className="min-w-0 truncate text-sm font-semibold tracking-tight" title={siteName}>{siteName}</span>
  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-0 rounded-[inherit]" aria-hidden="true">
        <GlassSurface variant="liquid" className="absolute inset-0 h-full w-full rounded-[inherit] border-0 shadow-none" radius={24} />
      </div>
      <div className="relative z-10 flex min-h-16 shrink-0 items-center justify-between gap-3 px-6 py-2">
        {mobile ? <DialogPrimitive.Title asChild>{brand}</DialogPrimitive.Title> : brand}
        {mobile ? (
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" className="shrink-0 rounded-full" aria-label={t('common.close')}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
        ) : null}
      </div>
      <ScrollArea className="relative z-10 min-h-0 flex-1" orientation="vertical" viewportClassName="h-full overscroll-contain" viewportProps={{ 'aria-label': t(groups[0]?.titleKey ?? 'nav.groupResources') }}>
        <nav className="space-y-6 px-3 py-5" aria-label={t(groups[0]?.titleKey ?? 'nav.groupResources')}>
          {groups.map(group => (
            <div key={group.titleKey} className="space-y-1.5">
              <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground">{t(group.titleKey)}</p>
              {group.items.map(item => item.comingSoon ? (
                <div key={item.to} aria-disabled="true" className="flex min-h-11 cursor-not-allowed items-center justify-between gap-3 rounded-2xl px-3 text-sm text-muted-foreground lg:min-h-10" title={t('dashboard.comingSoon')}>
                  <span className="min-w-0 truncate">{t(item.labelKey)}</span>
                  <span className="shrink-0 text-xs">{t('dashboard.comingSoon')}</span>
                </div>
              ) : (
                <NavLink key={item.to} to={item.to} end={item.to === '/' || item.to === '/admin'} onClick={onClose} className={({ isActive }) => cn(
                  'flex min-h-11 items-center rounded-2xl border border-transparent px-3 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none lg:min-h-10 lg:text-sm',
                  isActive ? 'bg-foreground/[0.07] font-semibold text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
                )}>
                  <span className="min-w-0 truncate">{t(item.labelKey)}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </ScrollArea>
      <div className="relative z-10 shrink-0 px-6 py-4 text-xs leading-relaxed text-muted-foreground">{t('app.tagline')}</div>
    </>
  )
}

export function Sidebar({ groups, open, onClose, triggerRef }: SidebarProps) {
  const { t } = useTranslation()
  const { basic } = useSiteConfig()
  const siteName = typeof basic.siteName === 'string' && basic.siteName.trim() ? basic.siteName : t('app.name')
  return (
    <>
      <aside aria-label={t(groups[0]?.titleKey ?? 'nav.groupResources')} className="fixed bottom-4 left-4 top-4 z-30 isolate hidden w-52 flex-col overflow-hidden rounded-3xl border border-border/60 lg:flex">
        <NavigationContents groups={groups} onClose={onClose} siteName={siteName} />
      </aside>
      <DialogPrimitive.Root open={open} onOpenChange={value => { if (!value) onClose() }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px] motion-reduce:backdrop-blur-none lg:hidden" />
          <DialogPrimitive.Content id="primary-navigation" aria-describedby={undefined} onCloseAutoFocus={event => {
            event.preventDefault()
            if (triggerRef?.current?.offsetParent !== null) triggerRef?.current?.focus()
          }} className="fixed bottom-4 left-4 top-4 z-50 isolate flex w-[min(18rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-border/60 shadow-lg outline-none lg:hidden">
            <NavigationContents groups={groups} onClose={onClose} siteName={siteName} mobile />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}
