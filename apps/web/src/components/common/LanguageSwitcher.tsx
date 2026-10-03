import { useTranslation } from 'react-i18next'
import { RoleType } from '@lunar/shared'
import { Select } from '@/components/ui/select'
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
    <Select
      aria-label="language"
      className="h-8 w-[8.5rem]"
      value={i18n.language}
      onChange={(event) => changeLocale(event.target.value as Locale)}
    >
      {(Object.keys(LOCALE_LABELS) as Locale[]).map((locale) => (
        <option key={locale} value={locale}>
          {LOCALE_LABELS[locale]}
        </option>
      ))}
    </Select>
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
