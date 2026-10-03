import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@lunar/shared'
import de from './locales/de'
import en from './locales/en'
import jp from './locales/jp'
import zhTW from './locales/zh-TW'

const STORAGE_KEY = 'lunar-locale'

function resolveInitialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as Locale
  const browser = navigator.language?.toLowerCase() ?? ''
  if (browser.startsWith('zh')) return 'zh-TW'
  if (browser.startsWith('ja')) return 'jp'
  if (browser.startsWith('de')) return 'de'
  if (browser.startsWith('en')) return 'en'
  return DEFAULT_LOCALE
}

void i18n.use(initReactI18next).init({
  resources: {
    'zh-TW': { translation: zhTW },
    en: { translation: en },
    jp: { translation: jp },
    de: { translation: de },
  },
  lng: resolveInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
})

export function changeLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale)
  void i18n.changeLanguage(locale)
}

export default i18n
