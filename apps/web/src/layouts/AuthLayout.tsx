import { Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '@/components/ui/card'
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { useSiteConfig } from '@/components/common/SiteConfigProvider'

export function AuthLayout() {
  const { t } = useTranslation()
  const { basic } = useSiteConfig()
  const siteName = typeof basic.siteName === 'string' && basic.siteName.trim() ? basic.siteName : t('app.name')

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-20 sm:px-6 sm:py-24">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 sm:right-6 sm:top-6">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <main className="w-full max-w-md motion-safe:animate-fade-in motion-reduce:animate-none">
        <div className="mb-7 text-center">
          <h1 className="text-xl font-semibold tracking-tight">{siteName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('app.tagline')}</p>
        </div>
        <Card>
          <CardContent className="p-6 sm:p-8">
            <Outlet />
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
