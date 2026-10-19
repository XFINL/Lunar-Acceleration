import type { Ref } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Menu } from 'lucide-react'
import { RoleType } from '@lunar/shared'
import { authApi } from '@/api/auth'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { GlassSurface } from '@/components/common/GlassSurface'
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { useAuthStore } from '@/stores/auth'

interface HeaderProps {
  onMenuClick: () => void
  sidebarOpen?: boolean
  menuButtonRef?: Ref<HTMLButtonElement>
}

export function Header({ onMenuClick, sidebarOpen, menuButtonRef }: HeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const refreshToken = useAuthStore((state) => state.refreshToken)
  const clear = useAuthStore((state) => state.clear)
  const userName = user?.nickname ?? user?.username ?? t('nav.account')
  const roleLabel = user?.roleType === RoleType.SUPER_ADMIN
    ? t('roleType.superAdmin') : user?.roleType === RoleType.ADMIN
      ? t('roleType.admin') : t('roleType.user')

  const handleLogout = async () => {
    try {
      if (refreshToken) await authApi.logout(refreshToken)
    } catch {
      // Local sign-out must still work if the endpoint is unavailable.
    }
    clear()
    navigate('/login', { replace: true })
  }

  return (
    <header className="sticky top-4 z-20 isolate mx-4 mt-4 flex min-h-16 items-center rounded-3xl border border-border/60 px-2 py-2 sm:mx-6 sm:px-4">
      <div className="pointer-events-none absolute inset-0 z-0 rounded-[inherit]" aria-hidden="true">
        <GlassSurface variant="liquid" className="absolute inset-0 h-full w-full rounded-[inherit] border-0 shadow-none" radius={24} />
      </div>
      <div className="relative z-10 flex min-w-0 w-full items-center justify-between gap-1.5 sm:justify-start sm:gap-3">
        <Button ref={menuButtonRef} variant="ghost" size="icon" className="shrink-0 rounded-full lg:hidden" onClick={onMenuClick} aria-label={t('common.openNavigation')} aria-expanded={sidebarOpen ?? false} aria-controls="primary-navigation">
          <Menu className="h-4 w-4" aria-hidden="true" />
        </Button>
        <div className="hidden min-w-0 flex-1 sm:block" />
        <LanguageSwitcher />
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="frosted-control min-w-0 max-w-[24vw] shrink rounded-full px-2 sm:max-w-52 sm:px-3" aria-label={t('nav.account')}>
              <span className="truncate">{userName}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="space-y-1 break-words">
              <p className="font-semibold">{user?.username ?? userName}</p>
              <p className="text-xs font-normal text-muted-foreground">{roleLabel}</p>
              <p className="text-xs font-normal text-muted-foreground">{user?.balance ?? '0.00'}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => { void handleLogout() }}>{t('auth.logout')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
