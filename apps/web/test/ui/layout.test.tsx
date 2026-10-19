import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { SelectRoot, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/common/PageHeader'

describe('Shared layout contracts', () => {
  it('Input, Select and Button share one responsive height token', () => {
    render(<><Input aria-label="Name" /><SelectRoot value="all"><SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger></SelectRoot><Button>Save</Button></>)
    for (const control of [screen.getByRole('textbox', { name: 'Name' }), screen.getByRole('combobox'), screen.getByRole('button', { name: 'Save' })]) {
      expect(control.className).toContain('h-[var(--control-height)]')
    }
  })

  it('full-bleed card content can override all default panel padding', () => {
    render(<Card><CardHeader><CardTitle>Records</CardTitle></CardHeader><CardContent className="p-0" data-testid="content">Rows</CardContent></Card>)
    const content = screen.getByTestId('content')
    expect(content).toHaveClass('p-0')
    expect(content.className).not.toMatch(/(?:md:)?p-\[var\(--panel-padding\)\]/)
    expect(content.className).not.toMatch(/md:p-/)
  })

  it('indeterminate checkboxes retain accessible mixed state with a distinct indicator', () => {
    render(<><Label htmlFor="selection">Select records</Label><Checkbox id="selection" checked="indeterminate" /></>)
    expect(screen.getByRole('checkbox', { name: 'Select records' })).toHaveAttribute('aria-checked', 'mixed')
    expect(screen.getByRole('checkbox')).toHaveClass('h-5', 'w-5')
    expect(screen.getByRole('checkbox').querySelector('svg')).toBeInTheDocument()
  })

  it('page heading and description preserve semantic grouping with separate actions', () => {
    render(<PageHeader title="Domains" description="Manage your domains." actions={<Button>Add domain</Button>} />)
    const heading = screen.getByRole('heading', { name: 'Domains', level: 1 })
    expect(heading.parentElement).toContainElement(screen.getByText('Manage your domains.'))
    expect(heading.parentElement).not.toContainElement(screen.getByRole('button', { name: 'Add domain' }))
  })

  it('shadcn Button asChild styles the original link without nesting interactive elements', () => {
    const { container } = render(<Button asChild><a href="/domains">Manage domains</a></Button>)
    expect(screen.getByRole('link', { name: 'Manage domains' })).toHaveAttribute('href', '/domains')
    expect(screen.getByRole('link')).toHaveClass('h-[var(--control-height)]')
    expect(container.querySelector('button')).not.toBeInTheDocument()
    expect(container.children).toHaveLength(1)
  })
})
