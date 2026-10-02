import {
  Activity,
  Building2,
  CreditCard,
  FileText,
  Globe,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  Network,
  ScrollText,
  Server,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
} from 'lucide-react'
import { AppShell } from './AppShell'
import type { NavGroup } from './types'

const GROUPS: NavGroup[] = [
  {
    titleKey: 'nav.groupAdmin',
    items: [
      { to: '/admin', labelKey: 'nav.adminDashboard', icon: LayoutDashboard },
      { to: '/admin/users', labelKey: 'nav.adminUsers', icon: Users },
      { to: '/admin/roles', labelKey: 'nav.adminRoles', icon: ShieldCheck },
      { to: '/admin/audit', labelKey: 'nav.adminAudit', icon: ScrollText },
    ],
  },
  {
    titleKey: 'nav.groupResources',
    items: [
      { to: '/admin/domains', labelKey: 'nav.domains', icon: Globe, comingSoon: true },
      { to: '/admin/nodes', labelKey: 'nav.adminNodes', icon: Server, comingSoon: true },
      { to: '/admin/vendors', labelKey: 'nav.adminVendors', icon: Building2, comingSoon: true },
      { to: '/admin/schedule', labelKey: 'nav.adminSchedule', icon: Network, comingSoon: true },
      { to: '/admin/waf', labelKey: 'nav.waf', icon: Activity, comingSoon: true },
    ],
  },
  {
    titleKey: 'nav.adminSettings',
    items: [
      { to: '/admin/packages', labelKey: 'nav.packages', icon: CreditCard, comingSoon: true },
      { to: '/admin/orders', labelKey: 'nav.orders', icon: ShoppingCart, comingSoon: true },
      { to: '/admin/tickets', labelKey: 'nav.tickets', icon: LifeBuoy, comingSoon: true },
      { to: '/admin/notices', labelKey: 'nav.notices', icon: Megaphone, comingSoon: true },
      { to: '/admin/site-config', labelKey: 'nav.adminSiteConfig', icon: Settings, comingSoon: true },
      { to: '/admin/system-config', labelKey: 'nav.adminSystemConfig', icon: Settings, comingSoon: true },
      { to: '/admin/reports', labelKey: 'nav.adminReports', icon: FileText, comingSoon: true },
    ],
  },
]

export function AdminLayout() {
  return <AppShell groups={GROUPS} />
}
