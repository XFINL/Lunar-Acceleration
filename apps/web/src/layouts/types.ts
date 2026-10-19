export interface NavItem {
  to: string
  labelKey: string
  comingSoon?: boolean
}

export interface NavGroup {
  titleKey: string
  items: NavItem[]
}
