import { Injectable } from '@nestjs/common'
import { DEFAULT_LOCALE, ErrorCode, ERROR_MESSAGE_MAP, type Locale, LOCALES } from '@lunar/shared'
import de from './locales/de.json'
import en from './locales/en.json'
import jp from './locales/jp.json'
import zhTW from './locales/zh-TW.json'

type Dict = Record<string, string>

const DICTS: Record<Locale, Dict> = {
  'zh-TW': zhTW as Dict,
  en: en as Dict,
  jp: jp as Dict,
  de: de as Dict,
}

/**
 * 轻量 i18n：按 Accept-Language 翻译错误码
 * 对应 05-backend.md §13
 */
@Injectable()
export class I18nService {
  /** 从 Accept-Language 解析受支持的语言，默认 zh-TW */
  resolveLocale(acceptLanguage?: string | null): Locale {
    if (!acceptLanguage) return DEFAULT_LOCALE
    const candidates = acceptLanguage
      .split(',')
      .map((part) => part.split(';')[0]?.trim())
      .filter(Boolean)
    for (const candidate of candidates) {
      const lower = candidate.toLowerCase()
      const matched = LOCALES.find((locale) => locale.toLowerCase() === lower)
      if (matched) return matched
      // zh-cn / zh-hans 归一到 zh-TW
      if (lower.startsWith('zh')) return 'zh-TW'
      if (lower.startsWith('ja')) return 'jp'
      if (lower.startsWith('en')) return 'en'
      if (lower.startsWith('de')) return 'de'
    }
    return DEFAULT_LOCALE
  }

  /**
   * 翻译错误码，key 形如 error.40001；缺失时回退到中文内置文案
   */
  translateError(code: number, locale: Locale = DEFAULT_LOCALE): string {
    const dict = DICTS[locale] ?? DICTS[DEFAULT_LOCALE]
    const value = dict[`error.${code}`]
    if (value) return value
    return ERROR_MESSAGE_MAP[code as ErrorCode] ?? 'Error'
  }

  /** 通用 key 翻译 */
  translate(key: string, locale: Locale = DEFAULT_LOCALE): string {
    const dict = DICTS[locale] ?? DICTS[DEFAULT_LOCALE]
    return dict[key] ?? DICTS[DEFAULT_LOCALE][key] ?? key
  }
}
