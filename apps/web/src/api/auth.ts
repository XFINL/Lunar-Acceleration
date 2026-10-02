import { request } from './client'
import type { CaptchaResult, LoginResult, TokenPair, UserProfile } from './types'

export interface LoginPayload {
  username: string
  password: string
  captcha?: string
  captchaId?: string
  remember?: boolean
}

export interface RegisterPayload {
  username: string
  password: string
  email?: string
  inviteCode?: string
  captcha?: string
  captchaId?: string
}

export const authApi = {
  captcha: () => request.get<CaptchaResult>('/auth/captcha'),
  login: (payload: LoginPayload) => request.post<LoginResult>('/auth/login', payload),
  register: (payload: RegisterPayload) => request.post<LoginResult>('/auth/register', payload),
  refresh: (refreshToken: string) => request.post<TokenPair>('/auth/refresh', { refreshToken }),
  logout: (refreshToken?: string) => request.post<{ success: boolean }>('/auth/logout', { refreshToken }),
  profile: () => request.get<UserProfile>('/user/profile'),
}
