import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { RoleType } from '@lunar/shared'
import type { TokenPair, UserProfile } from '@/api/types'

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: UserProfile | null
  setSession: (tokens: TokenPair, user: UserProfile) => void
  setTokens: (tokens: TokenPair) => void
  setUser: (user: UserProfile) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setSession: (tokens, user) =>
        set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user }),
      setTokens: (tokens) =>
        set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
      setUser: (user) => set({ user }),
      clear: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: 'lunar-auth' },
  ),
)

/** 是否为管理员（含超管） */
export function selectIsAdmin(state: AuthState): boolean {
  return (state.user?.roleType ?? 0) >= RoleType.ADMIN
}

/** 是否拥有某权限点（超管恒为真） */
export function selectHasPermission(code: string): (state: AuthState) => boolean {
  return (state) => {
    if (!state.user) return false
    if (state.user.roleType === RoleType.SUPER_ADMIN) return true
    return state.user.permissions.includes(code)
  }
}
