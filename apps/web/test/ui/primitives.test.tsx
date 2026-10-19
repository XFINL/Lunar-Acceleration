import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { SelectRoot as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { ConfirmAction } from '@/components/common/ConfirmAction'

function StatusSelect() {
  const [value, setValue] = useState('all')
  return <Select value={value} onValueChange={setValue}>
    <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="all">All statuses</SelectItem>
      <SelectItem value="active">Active</SelectItem>
      <SelectItem value="offline" disabled>Offline</SelectItem>
    </SelectContent>
  </Select>
}

function DialogFixture() {
  const [open, setOpen] = useState(false)
  return <>
    <Button onClick={() => setOpen(true)}>Open editor</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Edit resource</DialogTitle>
        <DialogDescription>Update the resource status.</DialogDescription>
        <StatusSelect />
        <Button onClick={() => setOpen(false)}>Save</Button>
      </DialogContent>
    </Dialog>
  </>
}

describe('Radix-based UI contracts', () => {
  it('Select uses a real listbox and updates its controlled value', async () => {
    const user = userEvent.setup()
    render(<StatusSelect />)
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Offline' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('option', { name: 'Active' }))
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Active')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('Select preserves disabled semantics', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Select value="all" onValueChange={onChange} disabled>
      <SelectTrigger aria-label="Disabled status"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="all">All</SelectItem></SelectContent>
    </Select>)
    await user.click(screen.getByRole('combobox', { name: 'Disabled status' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Dialog portals outside its app container and restores an external trigger after Escape', async () => {
    const user = userEvent.setup()
    const { container } = render(<DialogFixture />)
    const opener = screen.getByRole('button', { name: 'Open editor' })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Edit resource' })
    expect(container.contains(dialog)).toBe(false)
    // Radix deliberately uses hideOthers rather than aria-modal for AT support.
    expect(container).toHaveAttribute('aria-hidden', 'true')
    expect(dialog.contains(document.activeElement)).toBe(true)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('Dialog without a description never creates a dangling aria-describedby reference', async () => {
    render(<Dialog open onOpenChange={() => {}}><DialogContent><DialogTitle>Simple editor</DialogTitle></DialogContent></Dialog>)
    const dialog = await screen.findByRole('dialog', { name: 'Simple editor' })
    expect(dialog).not.toHaveAttribute('aria-describedby')
  })

  it('a Select portal inside Dialog can be selected without closing the Dialog', async () => {
    const user = userEvent.setup()
    render(<DialogFixture />)
    await user.click(screen.getByRole('button', { name: 'Open editor' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(screen.getByRole('option', { name: 'Active' }))
    expect(screen.getByRole('dialog', { name: 'Edit resource' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Active')
  })

  it('Dialog keeps reverse-tab focus inside its focus scope', async () => {
    const user = userEvent.setup()
    render(<DialogFixture />)
    await user.click(screen.getByRole('button', { name: 'Open editor' }))
    const dialog = await screen.findByRole('dialog')
    within(dialog).getByRole('button', { name: 'Close' }).focus()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('dangerous actions never run on open, Cancel or Escape; explicit Confirm runs once', async () => {
    const action = vi.fn()
    const user = userEvent.setup()
    render(<ConfirmAction description="Delete this test resource?" onConfirm={action}><Button>Delete resource</Button></ConfirmAction>)
    await user.click(screen.getByRole('button', { name: 'Delete resource' }))
    expect(action).not.toHaveBeenCalled()
    const alert = screen.getByRole('alertdialog', { name: 'Confirm' })
    expect(within(alert).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(alert).getByRole('button', { name: 'Cancel' }))
    expect(action).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete resource' }))
    await user.keyboard('{Escape}')
    expect(action).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete resource' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm', exact: true }))
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('a disabled destructive trigger cannot open confirmation or execute an action', async () => {
    const action = vi.fn()
    const user = userEvent.setup()
    render(<ConfirmAction description="Delete disabled resource?" onConfirm={action}><Button disabled>Delete disabled resource</Button></ConfirmAction>)
    await user.click(screen.getByRole('button', { name: 'Delete disabled resource' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(action).not.toHaveBeenCalled()
  })

  it('Switch supports label-associated Space toggling', async () => {
    function Fixture() {
      const [checked, setChecked] = useState(false)
      return <><Label htmlFor="enabled">Enabled</Label><Switch id="enabled" checked={checked} onCheckedChange={setChecked} /></>
    }
    const user = userEvent.setup()
    render(<Fixture />)
    const control = screen.getByRole('switch', { name: 'Enabled' })
    control.focus()
    await user.keyboard(' ')
    expect(control).toHaveAttribute('aria-checked', 'true')
  })

  it('Checkbox retains native form data and association with its visible label', async () => {
    function Fixture() {
      const [checked, setChecked] = useState(false)
      return <form aria-label="Preferences"><Label htmlFor="remember">Remember me</Label><Checkbox id="remember" name="remember" checked={checked} onCheckedChange={value => setChecked(value === true)} /></form>
    }
    const user = userEvent.setup()
    render(<Fixture />)
    await user.click(screen.getByText('Remember me'))
    expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeChecked()
    expect(new FormData(screen.getByRole('form', { name: 'Preferences' }) as HTMLFormElement).get('remember')).toBe('on')
  })

  it('Tabs have proper roles and keyboard navigation updates controlled selection', async () => {
    function Fixture() {
      const [value, setValue] = useState('first')
      return <Tabs value={value} onValueChange={setValue} items={[{ value: 'first', label: 'First' }, { value: 'second', label: 'Second' }]} />
    }
    const user = userEvent.setup()
    render(<Fixture />)
    screen.getByRole('tab', { name: 'First' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Second' })).toHaveFocus()
  })

  it('ScrollArea keeps a native focusable viewport rather than intercepting document scrolling', () => {
    render(<ScrollArea viewportProps={{ 'aria-label': 'Records' }}><p>Visible record</p></ScrollArea>)
    const viewport = screen.getByLabelText('Records')
    expect(viewport).toHaveAttribute('data-radix-scroll-area-viewport')
    expect(viewport).toHaveAttribute('tabindex', '0')
    expect(viewport).toHaveTextContent('Visible record')
  })

  it('DropdownMenu supplies menu semantics and restores keyboard focus', async () => {
    const user = userEvent.setup()
    render(<DropdownMenu><DropdownMenuTrigger asChild><Button>Account</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu>)
    const opener = screen.getByRole('button', { name: 'Account' })
    await user.click(opener)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(opener).toHaveFocus())
  })
})
