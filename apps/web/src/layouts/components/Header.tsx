import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LogOut, Menu, ShieldCheck, User as UserIcon } from 'lucide-react'
import { RoleType } from '@lunar/shared'
import { authApi } from '@/api/auth'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { useAuthStore } from '@/stores/auth'

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const refreshToken = useAuthStore((state) => state.refreshToken)
  const clear = useAuthStore((state) => state.clear)
  const [menuOpen, setMenuOpen] = useState(false)

  const roleLabel =
    user?.roleType === RoleType.SUPER_ADMIN
      ? t('roleType.superAdmin')
      : user?.roleType === RoleType.ADMIN
        ? t('roleType.admin')
        : t('roleType.user')

  const handleLogout = async () => {
    try {
      if (refreshToken) await authApi.logout(refreshToken)
    } catch {
      // 忽略登出接口异常，本地会话仍需清理
    }
    clear()
    navigate('/login', { replace: true })
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick}>
        <Menu className="h-4 w-4" />
      </Button>

      <div className="flex-1" />

      <LanguageSwitcher />
      <ThemeToggle />

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-accent"
        >
          <Avatar name={user?.nickname ?? user?.username} src={user?.avatar} className="h-8 w-8" />
          <span className="hidden text-sm font-medium sm:block">
            {user?.nickname ?? user?.username}
          </span>
        </button>

        {menuOpen ? (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
            <div className="absolute right-0 z-20 mt-2 w-56 animate-fade-in rounded-lg border bg-popover p-2 shadow-lg">
              <div className="flex items-center gap-2 rounded-md px-2 py-2">
                <Avatar name={user?.nickname ?? user?.username} src={user?.avatar} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{user?.username}</p>
                  <p className="text-xs text-muted-foreground">{user?.balance ?? '0.00'}</p>
                </div>
              </div>
              <div className="px-2 pb-2">
                <Badge variant={user?.roleType === RoleType.USER ? 'secondary' : 'default'}>
                  {user?.roleType === RoleType.USER ? (
                    <UserIcon className="mr-1 h-3 w-3" />
                  ) : (
                    <ShieldCheck className="mr-1 h-3 w-3" />
                  )}
                  {roleLabel}
                </Badge>
              </div>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                {t('auth.logout')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </header>
  )
}
