import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { ThemeToggle } from '@/components/common/ThemeToggle'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  i18n.addResource('en', 'translation', 'common.darkMode', 'Dark mode')
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

function preferDarkSystem() {
  const original = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ ...original(query), matches: query === '(prefers-color-scheme: dark)' }))
}

describe('Theme switch', () => {
  it('restores saved dark mode using a real switch without decorative icons or a second control', () => {
    localStorage.setItem('lunar-theme', 'dark')
    const { container } = render(<ThemeToggle />)
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toBeChecked()
    expect(document.documentElement).toHaveClass('dark')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.frosted-control')).toHaveLength(1)
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('click and Space switch both theme state and the persisted preference', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    const control = screen.getByRole('switch', { name: 'Dark mode' })
    expect(control).not.toBeChecked()
    await user.click(control)
    expect(control).toBeChecked()
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem('lunar-theme')).toBe('dark')
    control.focus()
    await user.keyboard(' ')
    expect(control).not.toBeChecked()
    expect(document.documentElement).not.toHaveClass('dark')
    expect(localStorage.getItem('lunar-theme')).toBe('light')
  })

  it('retains the chosen mode when the header or login layout remounts', async () => {
    const user = userEvent.setup()
    const first = render(<ThemeToggle />)
    await user.click(screen.getByRole('switch'))
    first.unmount()
    render(<ThemeToggle />)
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toBeChecked()
  })

  it('a saved light preference overrides a dark system preference', () => {
    preferDarkSystem()
    localStorage.setItem('lunar-theme', 'light')
    render(<ThemeToggle />)
    expect(screen.getByRole('switch')).not.toBeChecked()
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it.each([null, 'invalid'])('falls back to the system preference for %s stored mode', stored => {
    preferDarkSystem()
    if (stored) localStorage.setItem('lunar-theme', stored)
    render(<ThemeToggle />)
    expect(screen.getByRole('switch')).toBeChecked()
    expect(localStorage.getItem('lunar-theme')).toBe('dark')
  })

  it('remains usable if browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Storage denied', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Storage denied', 'SecurityError') })
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await user.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toBeChecked()
    expect(document.documentElement).toHaveClass('dark')
  })
})
