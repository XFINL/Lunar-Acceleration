import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import type { NavGroup } from './types'

export function AppShell({ groups }: { groups: NavGroup[] }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const closeOnDesktop = () => { if (desktop.matches) closeSidebar() }
    desktop.addEventListener('change', closeOnDesktop)
    closeOnDesktop()
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [closeSidebar])

  return (
    <div className="min-h-screen bg-transparent text-foreground">
      <Sidebar groups={groups} open={sidebarOpen} onClose={closeSidebar} triggerRef={menuButtonRef} />
      <div className="min-h-screen min-w-0 lg:pl-60">
        <Header onMenuClick={() => setSidebarOpen(true)} sidebarOpen={sidebarOpen} menuButtonRef={menuButtonRef} />
        <main className="mx-auto w-full min-w-0 max-w-7xl p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
