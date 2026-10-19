import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { request } from '@/api/client'
import { monochromePalette } from '@/lib/monochrome'

type ConfigMap = Record<string, unknown>
interface SiteConfigState {
  basic: ConfigMap
  seo: ConfigMap
  theme: ConfigMap
  register: ConfigMap
}
const EMPTY: SiteConfigState = { basic: {}, seo: {}, theme: {}, register: {} }
const SiteConfigContext = createContext<SiteConfigState>(EMPTY)

function safeFaviconUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const raw = value.trim()
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.href : undefined
  } catch { return undefined }
}

export function SiteConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState(EMPTY)
  useEffect(() => {
    let active = true
    void Promise.all(['basic', 'seo', 'theme', 'register'].map((group) =>
      request.get<ConfigMap>(`/user/site-config/${group}`).then((value) => [group, value] as const).catch(() => [group, {}] as const),
    )).then((entries) => {
      if (!active) return
      const loaded = Object.fromEntries(entries) as unknown as SiteConfigState
      setConfig({ ...EMPTY, ...loaded })
      const title = typeof loaded.seo?.title === 'string' && loaded.seo.title.trim()
        ? loaded.seo.title : loaded.basic?.siteName
      if (typeof title === 'string' && title.trim()) document.title = title
      const description = loaded.seo?.description
      if (typeof description === 'string') {
        let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
        if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta) }
        meta.content = description.slice(0, 1000)
      }
      const palette = monochromePalette(loaded.theme?.primaryColor)
      // Remove legacy inline overrides so light/dark CSS tokens can work again.
      document.documentElement.style.removeProperty('--primary')
      document.documentElement.style.removeProperty('--ring')
      if (palette) {
        document.documentElement.style.setProperty('--site-primary-light', palette.light)
        document.documentElement.style.setProperty('--site-primary-dark', palette.dark)
      }
      const radius = loaded.theme?.radius
      if (typeof radius === 'number' && Number.isFinite(radius) && radius >= 0 && radius <= 64) {
        document.documentElement.style.setProperty('--radius', `${radius / 16}rem`)
      }
      const mode = loaded.theme?.darkMode
      if (mode === 'dark') document.documentElement.classList.add('dark')
      else if (mode === 'light') document.documentElement.classList.remove('dark')
      const favicon = safeFaviconUrl(loaded.basic?.favicon)
      if (favicon) {
        let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
        if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
        link.href = favicon
      }
      // Custom CSS, arbitrary HTML, analytics scripts, and logo data are deliberately never executed/injected.
    })
    return () => { active = false }
  }, [])
  const value = useMemo(() => config, [config])
  return <SiteConfigContext.Provider value={value}>{children}</SiteConfigContext.Provider>
}

export function useSiteConfig(): SiteConfigState {
  return useContext(SiteConfigContext)
}
