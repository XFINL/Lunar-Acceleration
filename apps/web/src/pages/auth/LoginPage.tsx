import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { authApi } from '@/api/auth'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth'
import { useSiteConfig } from '@/components/common/SiteConfigProvider'

interface LocationState {
  from?: string
}

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const setSession = useAuthStore((state) => state.setSession)
  const siteConfig = useSiteConfig()

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
    <form className="page-stack" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold">{t('auth.loginTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('auth.loginSubtitle')}</p>
      </div>

      <div className="form-field">
        <Label htmlFor="username">{t('auth.username')}</Label>
        <Input
          id="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
      </div>

      <div className="form-field">
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

      <div className="form-field">
        <Label htmlFor="captcha">{t('auth.captcha')}</Label>
        <div className="control-row">
          <Input
            id="captcha"
            value={captcha}
            onChange={(event) => setCaptcha(event.target.value)}
            required
          />
          <button
            type="button"
            onClick={() => void loadCaptcha()}
            className="frosted-control flex h-9 w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-xl"
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
          >
            {captchaImage ? (
              <img src={captchaImage} alt="captcha" className="h-full w-full object-contain grayscale" />
            ) : (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      <div className="control-row text-sm text-muted-foreground">
        <Checkbox
          id="remember"
          checked={remember}
          onCheckedChange={(checked) => setRemember(checked === true)}
        />
        <Label htmlFor="remember" className="cursor-pointer text-muted-foreground">
          {t('auth.remember')}
        </Label>
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? t('common.loading') : t('auth.login')}
      </Button>

      {siteConfig.register.open !== false ? <p className="text-center text-sm text-muted-foreground">
        {t('auth.noAccount')}{' '}
        <Link to="/register" className="font-medium text-foreground hover:underline">
          {t('auth.goRegister')}
        </Link>
      </p> : null}
    </form>
  )
}
