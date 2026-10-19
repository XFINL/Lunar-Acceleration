import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AdminLayout } from '@/layouts/AdminLayout'
import { AuthLayout } from '@/layouts/AuthLayout'
import { UserLayout } from '@/layouts/UserLayout'
import { ProtectedRoute } from '@/routes/ProtectedRoute'
import { ComingSoonPage } from '@/pages/ComingSoonPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { DashboardPage } from '@/pages/user/DashboardPage'
import { ProfilePage } from '@/pages/user/ProfilePage'
import { ApiKeysPage } from '@/pages/user/ApiKeysPage'
import { LoginLogsPage } from '@/pages/user/LoginLogsPage'
import { PackagesPage } from '@/pages/user/PackagesPage'
import { OrdersPage } from '@/pages/user/OrdersPage'
import { AdminDashboardPage } from '@/pages/admin/AdminDashboardPage'
import { UsersPage } from '@/pages/admin/UsersPage'
import { RolesPage } from '@/pages/admin/RolesPage'
import { AuditPage } from '@/pages/admin/AuditPage'
import { AdminPackagesPage } from '@/pages/admin/AdminPackagesPage'
import { AdminOrdersPage } from '@/pages/admin/AdminOrdersPage'
import { SiteConfigPage } from '@/pages/admin/SiteConfigPage'
import { SystemConfigPage } from '@/pages/admin/SystemConfigPage'
import { DomainsPage } from '@/pages/user/DomainsPage'
import { CachePage } from '@/pages/user/CachePage'
import { OriginsPage } from '@/pages/user/OriginsPage'
import { CertificatesPage } from '@/pages/user/CertificatesPage'
import { AdminDomainsPage } from '@/pages/admin/AdminDomainsPage'
import { VendorsPage } from '@/pages/admin/VendorsPage'
import { StatisticsPage } from '@/pages/user/StatisticsPage'

/** 用户端尚未实现的模块（侧边栏标为 comingSoon），统一落到占位页 */
const USER_COMING_SOON = [
  'purge',
  'waf',
  'logs',
  'tickets',
  'notices',
]

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <UserLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="account" element={<ProfilePage />} />
          <Route path="account/api-keys" element={<ApiKeysPage />} />
          <Route path="account/login-logs" element={<LoginLogsPage />} />
          <Route path="packages" element={<PackagesPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="domains" element={<DomainsPage />} />
          <Route path="cache" element={<CachePage />} />
          <Route path="origin" element={<OriginsPage />} />
          <Route path="certificates" element={<CertificatesPage />} />
          <Route path="statistics" element={<StatisticsPage />} />
          {USER_COMING_SOON.map((path) => (
            <Route key={path} path={path} element={<ComingSoonPage />} />
          ))}
        </Route>

        <Route
          path="/admin"
          element={
            <ProtectedRoute requireAdmin>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboardPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="packages" element={<AdminPackagesPage />} />
          <Route path="orders" element={<AdminOrdersPage />} />
          <Route path="site-config" element={<SiteConfigPage />} />
          <Route path="system-config" element={<SystemConfigPage />} />
          <Route path="domains" element={<AdminDomainsPage />} />
          <Route path="vendors" element={<VendorsPage />} />
          <Route path="*" element={<ComingSoonPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
