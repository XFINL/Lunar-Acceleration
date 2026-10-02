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
import { AdminDashboardPage } from '@/pages/admin/AdminDashboardPage'
import { UsersPage } from '@/pages/admin/UsersPage'
import { RolesPage } from '@/pages/admin/RolesPage'
import { AuditPage } from '@/pages/admin/AuditPage'

/** 用户端尚未实现的模块（侧边栏标为 comingSoon），统一落到占位页 */
const USER_COMING_SOON = [
  'domains',
  'cache',
  'origin',
  'certificates',
  'purge',
  'waf',
  'statistics',
  'logs',
  'packages',
  'orders',
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
          <Route path="*" element={<ComingSoonPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
