import { AppShell } from './AppShell'
import type { NavGroup } from './types'

const GROUPS: NavGroup[] = [
  {
    titleKey: 'nav.groupUser',
    items: [
      { to: '/', labelKey: 'nav.dashboard' },
      { to: '/account', labelKey: 'nav.account' },
      { to: '/account/api-keys', labelKey: 'nav.apiKeys' },
      { to: '/account/login-logs', labelKey: 'nav.loginLogs' },
    ],
  },
  {
    titleKey: 'nav.groupResources',
    items: [
      { to: '/domains', labelKey: 'nav.domains' },
      { to: '/cache', labelKey: 'nav.cache' },
      { to: '/origin', labelKey: 'nav.origin' },
      { to: '/certificates', labelKey: 'nav.certificates' },
      { to: '/purge', labelKey: 'nav.purge', comingSoon: true },
      { to: '/waf', labelKey: 'nav.waf', comingSoon: true },
      { to: '/statistics', labelKey: 'nav.statistics' },
      { to: '/logs', labelKey: 'nav.logs' },
    ],
  },
  {
    titleKey: 'nav.packages',
    items: [
      { to: '/packages', labelKey: 'nav.packages' },
      { to: '/orders', labelKey: 'nav.orders' },
      { to: '/tickets', labelKey: 'nav.tickets', comingSoon: true },
      { to: '/notices', labelKey: 'nav.notices', comingSoon: true },
    ],
  },
]

export function UserLayout() {
  return <AppShell groups={GROUPS} />
}
