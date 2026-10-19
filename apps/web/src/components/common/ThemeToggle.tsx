import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { readThemePreference, THEME_STORAGE_KEY } from '@/lib/theme'

export function ThemeToggle() {
  const { t } = useTranslation()
  const id = useId()
  const [dark, setDark] = useState(readThemePreference)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light')
    } catch {
      // The theme remains usable when persistence is unavailable.
    }
  }, [dark])

  return (
    <div className="inline-flex h-[var(--control-height)] shrink-0 items-center gap-2">
      <Label htmlFor={id} className="hidden text-sm leading-5 text-muted-foreground sm:inline">
        {t('common.darkMode')}
      </Label>
      <Switch
        id={id}
        aria-label={t('common.darkMode')}
        title={t('common.darkMode')}
        checked={dark}
        onCheckedChange={setDark}
        className="relative before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-['']"
      />
    </div>
  )
}
