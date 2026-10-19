import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

await i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: { common: { close: 'Close', cancel: 'Cancel', confirm: 'Confirm', previousPage: 'Previous page', nextPage: 'Next page', total: '{{count}} items' } } } },
  interpolation: { escapeValue: false },
})

Object.defineProperty(window, 'matchMedia', { writable: true, value: (query: string) => ({
  matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true },
}) })

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', TestResizeObserver)

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string
  readonly isPrimary: boolean
  constructor(type: string, props: PointerEventInit = {}) {
    super(type, props)
    this.pointerId = props.pointerId ?? 1
    this.pointerType = props.pointerType ?? 'mouse'
    this.isPrimary = props.isPrimary ?? true
  }
}
vi.stubGlobal('PointerEvent', TestPointerEvent)
Object.defineProperties(HTMLElement.prototype, {
  hasPointerCapture: { configurable: true, value() { return false } },
  setPointerCapture: { configurable: true, value() {} },
  releasePointerCapture: { configurable: true, value() {} },
  scrollIntoView: { configurable: true, value() {} },
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
