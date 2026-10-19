import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { authApi } from '@/api/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth'
import { useSiteConfig } from '@/components/common/SiteConfigProvider'

export function RegisterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setSession = useAuthStore((state) => state.setSession)
  const siteConfig = useSiteConfig()
  const registrationOpen = siteConfig.register.open !== false
  const needsEmail = siteConfig.register.needEmail === true
  const needsInvite = siteConfig.register.inviteRequired === true
  const needsCaptcha = siteConfig.register.needCaptcha !== false

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [captchaId, setCaptchaId] = useState('')
  const [captchaImage, setCaptchaImage] = useState('')
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
    if (needsCaptcha) void loadCaptcha()
  }, [loadCaptcha, needsCaptcha])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const result = await authApi.register({
        username,
        password,
        email: email || undefined,
        inviteCode: inviteCode || undefined,
        ...(needsCaptcha ? { captcha, captchaId } : {}),
      })
      setSession(result, result.user)
      toast.success(t('auth.registerSuccess'))
      navigate('/', { replace: true })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t('common.failed')
      toast.error(message)
      void loadCaptcha()
    } finally {
      setSubmitting(false)
    }
  }

  if (!registrationOpen) return <p className="text-center text-sm text-muted-foreground">目前暫不開放註冊。</p>

  return (
    <form className="page-stack" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold">{t('auth.registerTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('auth.registerSubtitle')}</p>
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
        <Label htmlFor="email">
          {t('auth.email')} {!needsEmail ? <span className="text-muted-foreground">({t('common.optional')})</span> : null}
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          required={needsEmail}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="form-field">
        <Label htmlFor="password">{t('auth.password')}</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">{t('auth.passwordHint')}</p>
      </div>

      <div className="form-field">
        <Label htmlFor="inviteCode">
          {t('auth.inviteCode')}{' '}
          {!needsInvite ? <span className="text-muted-foreground">({t('common.optional')})</span> : null}
        </Label>
        <Input
          id="inviteCode"
          value={inviteCode}
          required={needsInvite}
          onChange={(event) => setInviteCode(event.target.value)}
        />
      </div>

      {needsCaptcha ? <div className="form-field">
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
      </div> : null}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? t('common.loading') : t('auth.register')}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t('auth.hasAccount')}{' '}
        <Link to="/login" className="font-medium text-foreground hover:underline">
          {t('auth.goLogin')}
        </Link>
      </p>
    </form>
  )
}
