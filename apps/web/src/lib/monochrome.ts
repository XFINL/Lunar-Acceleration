/** Preserve configurable tonal preference without reintroducing a colored accent. */
export function monochromePalette(value: unknown): { light: string; dark: string } | undefined {
  if (typeof value !== 'string' || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) return undefined
  const hex = value.length === 4 ? `#${value.slice(1).split('').map(channel => channel + channel).join('')}` : value
  const [r, g, b] = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return {
    light: `0 0% ${14 + Math.round(brightness * 12)}%`,
    dark: `0 0% ${94 - Math.round(brightness * 12)}%`,
  }
}
