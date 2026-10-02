import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  labelKey: string
  icon: LucideIcon
  comingSoon?: boolean
}

export interface NavGroup {
  titleKey: string
  items: NavItem[]
}
