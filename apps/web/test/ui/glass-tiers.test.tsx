import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { GlassPreferencesProvider, GlassSurface } from '@/components/common/GlassSurface'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/common/EmptyState'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableRow, TableCell } from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'

vi.mock('liquid-glass-react', () => ({ default: () => <span data-testid="liquid-engine" /> }))

describe('Frosted surfaces and navigation-only liquid glass', () => {
  beforeEach(() => {
    vi.stubGlobal('CSS', { supports: () => true })
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: () => void) {}
      observe() { this.callback() }
      disconnect() {}
    })
  })

  it('normal surfaces use only their own element and never mount a decorative liquid layer', () => {
    const { container } = render(<GlassPreferencesProvider><GlassSurface>Ordinary surface</GlassSurface></GlassPreferencesProvider>)
    const surface = screen.getByText('Ordinary surface')
    expect(surface).toHaveClass('frosted-panel')
    expect(surface).toHaveAttribute('data-glass-variant', 'frosted')
    expect(surface).toHaveAttribute('data-glass-enhanced', 'false')
    expect(container.querySelector('[data-liquid-glass-layer]')).not.toBeInTheDocument()
    expect(container.querySelectorAll('div')).toHaveLength(1)
  })

  it('only explicitly opted-in navigation creates a liquid backdrop', async () => {
    const { container } = render(<GlassPreferencesProvider><GlassSurface variant="liquid">Navigation</GlassSurface></GlassPreferencesProvider>)
    await waitFor(() => expect(screen.getByText('Navigation')).toHaveAttribute('data-glass-enhanced', 'true'))
    expect(container.querySelectorAll('[data-liquid-glass-layer]')).toHaveLength(1)
  })

  it('cards and controls are directly frosted without nested liquid components', () => {
    const { container } = render(<Card><CardContent><Input aria-label="Domain" /><EmptyState title="No records" /></CardContent></Card>)
    expect(container.firstElementChild).toHaveClass('frosted-panel')
    expect(screen.getByRole('textbox', { name: 'Domain' })).toHaveClass('frosted-control')
    expect(container.querySelector('[data-liquid-glass-layer]')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.frosted-panel')).toHaveLength(1)
    expect(screen.getByText('No records').closest('.glass-panel')).not.toBeInTheDocument()
  })

  it('tables scroll inside their existing card without adding a second frosted background', () => {
    const { container } = render(<Card><CardContent className="p-0"><Table><TableBody><TableRow><TableCell>example.com</TableCell></TableRow></TableBody></Table></CardContent></Card>)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(container.querySelectorAll('.frosted-panel')).toHaveLength(1)
    expect(container.querySelectorAll('[data-radix-scroll-area-viewport]')).toHaveLength(1)
  })

  it('unchecked switches retain their frosted track and a contrasting thumb', () => {
    render(<Switch aria-label="Enable HTTPS" checked={false} />)
    const control = screen.getByRole('switch', { name: 'Enable HTTPS' })
    expect(control).toHaveClass('frosted-control')
    expect(control.className).not.toContain('data-[state=unchecked]:bg-transparent')
    expect(control.firstElementChild).toHaveClass('bg-foreground/80', 'data-[state=checked]:bg-primary-foreground')
  })
})
