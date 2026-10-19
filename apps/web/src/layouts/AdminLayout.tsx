import { AppShell } from './AppShell'
import type { NavGroup } from './types'

const GROUPS: NavGroup[] = [
  {
    titleKey: 'nav.groupAdmin',
    items: [
      { to: '/admin', labelKey: 'nav.adminDashboard' },
      { to: '/admin/users', labelKey: 'nav.adminUsers' },
      { to: '/admin/roles', labelKey: 'nav.adminRoles' },
      { to: '/admin/audit', labelKey: 'nav.adminAudit' },
    ],
  },
  {
    titleKey: 'nav.groupResources',
    items: [
      { to: '/admin/domains', labelKey: 'nav.domains' },
      { to: '/admin/nodes', labelKey: 'nav.adminNodes', comingSoon: true },
      { to: '/admin/vendors', labelKey: 'nav.adminVendors' },
      { to: '/admin/schedule', labelKey: 'nav.adminSchedule', comingSoon: true },
      { to: '/admin/waf', labelKey: 'nav.waf', comingSoon: true },
    ],
  },
  {
    titleKey: 'nav.adminSettings',
    items: [
      { to: '/admin/packages', labelKey: 'nav.packages' },
      { to: '/admin/orders', labelKey: 'nav.orders' },
      { to: '/admin/tickets', labelKey: 'nav.tickets', comingSoon: true },
      { to: '/admin/notices', labelKey: 'nav.notices', comingSoon: true },
      { to: '/admin/site-config', labelKey: 'nav.adminSiteConfig' },
      { to: '/admin/system-config', labelKey: 'nav.adminSystemConfig' },
      { to: '/admin/reports', labelKey: 'nav.adminReports', comingSoon: true },
    ],
  },
]

export function AdminLayout() {
  return <AppShell groups={GROUPS} />
}
