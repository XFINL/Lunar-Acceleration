import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { RoleType } from '@lunar/shared'
import { useAuthStore } from '@/stores/auth'

interface ProtectedRouteProps {
  children: ReactNode
  requireAdmin?: boolean
}

export function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const location = useLocation()
  const accessToken = useAuthStore((state) => state.accessToken)
  const user = useAuthStore((state) => state.user)

  if (!accessToken || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (requireAdmin && user.roleType < RoleType.ADMIN) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
