import { useTranslation } from 'react-i18next'
import { RoleType } from '@lunar/shared'
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { changeLocale } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import type { Locale } from '@lunar/shared'

const LOCALE_LABELS: Record<Locale, string> = {
  'zh-TW': '繁體中文',
  en: 'English',
  jp: '日本語',
  de: 'Deutsch',
}

export function LanguageSwitcher() {
  const { i18n } = useTranslation()
  return (
    <SelectRoot value={i18n.language} onValueChange={(event) => changeLocale(event as Locale)}><SelectTrigger id="languageswitcher-select-1" className="w-[7rem] shrink-0 text-sm sm:w-[8.5rem] md:text-sm" aria-label="language"><SelectValue /></SelectTrigger><SelectContent>
      {(Object.keys(LOCALE_LABELS) as Locale[]).map((locale) => (
        <SelectItem key={locale} value={locale}>
          {LOCALE_LABELS[locale]}
        </SelectItem>
      ))}
    </SelectContent></SelectRoot>
  )
}

export function RoleTypeLabel({ roleType }: { roleType: RoleType }) {
  const { t } = useTranslation()
  const map: Record<number, string> = {
    [RoleType.USER]: 'roleType.user',
    [RoleType.ADMIN]: 'roleType.admin',
    [RoleType.SUPER_ADMIN]: 'roleType.superAdmin',
  }
  return <>{t(map[roleType] ?? 'roleType.user')}</>
}

export function useCurrentUser() {
  return useAuthStore((state) => state.user)
}
