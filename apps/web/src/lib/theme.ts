export const THEME_STORAGE_KEY = 'lunar-theme'

export function readThemePreference(): boolean {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored === 'dark'
  } catch {
    // Storage can be blocked before React mounts, as well as during interaction.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
