import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { authApi } from '@/api/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth'

interface LocationState {
  from?: string
}

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const setSession = useAuthStore((state) => state.setSession)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [captchaId, setCaptchaId] = useState('')
  const [captchaImage, setCaptchaImage] = useState('')
  const [remember, setRemember] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const loadCaptcha = useCallback(async () => {
    try {
      const result = await authApi.captcha()
      setCaptchaId(result.captchaId)
      setCaptchaImage(result.image)
      setCaptcha('')
    } catch {
      toast.error(t('common.failed'))
    }
  }, [t])

  useEffect(() => {
    void loadCaptcha()
  }, [loadCaptcha])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const result = await authApi.login({
        username,
        password,
        captcha,
        captchaId,
        remember,
      })
      setSession(result, result.user)
      toast.success(t('auth.loginSuccess'))
      const from = (location.state as LocationState | null)?.from
      const fallback = result.user.roleType >= 2 ? '/admin' : '/'
      navigate(from ?? fallback, { replace: true })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t('common.failed')
      toast.error(message)
      void loadCaptcha()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold">{t('auth.loginTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('auth.loginSubtitle')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="username">{t('auth.username')}</Label>
        <Input
          id="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">{t('auth.password')}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="captcha">{t('auth.captcha')}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="captcha"
            value={captcha}
            onChange={(event) => setCaptcha(event.target.value)}
            required
          />
          <button
            type="button"
            onClick={() => void loadCaptcha()}
            className="flex h-9 w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted"
            title={t('common.refresh')}
          >
            {captchaImage ? (
              <img src={captchaImage} alt="captcha" className="h-full w-full object-contain" />
            ) : (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        {t('auth.remember')}
      </label>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? t('common.loading') : t('auth.login')}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t('auth.noAccount')}{' '}
        <Link to="/register" className="font-medium text-primary hover:underline">
          {t('auth.goRegister')}
        </Link>
      </p>
    </form>
  )
}
