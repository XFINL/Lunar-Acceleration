import {
  BarChart3,
  CreditCard,
  FileText,
  Fingerprint,
  Globe,
  History,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  Megaphone,
  RefreshCw,
  Server,
  ShieldAlert,
  ShoppingCart,
  UserCog,
} from 'lucide-react'
import { AppShell } from './AppShell'
import type { NavGroup } from './types'

const GROUPS: NavGroup[] = [
  {
    titleKey: 'nav.groupUser',
    items: [
      { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard },
      { to: '/account', labelKey: 'nav.account', icon: UserCog },
      { to: '/account/api-keys', labelKey: 'nav.apiKeys', icon: KeyRound },
      { to: '/account/login-logs', labelKey: 'nav.loginLogs', icon: History },
    ],
  },
  {
    titleKey: 'nav.groupResources',
    items: [
      { to: '/domains', labelKey: 'nav.domains', icon: Globe, comingSoon: true },
      { to: '/cache', labelKey: 'nav.cache', icon: Fingerprint, comingSoon: true },
      { to: '/origin', labelKey: 'nav.origin', icon: Server, comingSoon: true },
      { to: '/certificates', labelKey: 'nav.certificates', icon: Lock, comingSoon: true },
      { to: '/purge', labelKey: 'nav.purge', icon: RefreshCw, comingSoon: true },
      { to: '/waf', labelKey: 'nav.waf', icon: ShieldAlert, comingSoon: true },
      { to: '/statistics', labelKey: 'nav.statistics', icon: BarChart3, comingSoon: true },
      { to: '/logs', labelKey: 'nav.logs', icon: FileText, comingSoon: true },
    ],
  },
  {
    titleKey: 'nav.packages',
    items: [
      { to: '/packages', labelKey: 'nav.packages', icon: CreditCard },
      { to: '/orders', labelKey: 'nav.orders', icon: ShoppingCart },
      { to: '/tickets', labelKey: 'nav.tickets', icon: LifeBuoy, comingSoon: true },
      { to: '/notices', labelKey: 'nav.notices', icon: Megaphone, comingSoon: true },
    ],
  },
]

export function UserLayout() {
  return <AppShell groups={GROUPS} />
}
