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

export function RegisterPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const setSession = useAuthStore((state) => state.setSession)

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
    void loadCaptcha()
  }, [loadCaptcha])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const result = await authApi.register({
        username,
        password,
        email: email || undefined,
        inviteCode: inviteCode || undefined,
        captcha,
        captchaId,
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

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold">{t('auth.registerTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('auth.registerSubtitle')}</p>
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
        <Label htmlFor="email">
          {t('auth.email')} <span className="text-muted-foreground">({t('common.optional')})</span>
        </Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="space-y-2">
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

      <div className="space-y-2">
        <Label htmlFor="inviteCode">
          {t('auth.inviteCode')}{' '}
          <span className="text-muted-foreground">({t('common.optional')})</span>
        </Label>
        <Input
          id="inviteCode"
          value={inviteCode}
          onChange={(event) => setInviteCode(event.target.value)}
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

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? t('common.loading') : t('auth.register')}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t('auth.hasAccount')}{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          {t('auth.goLogin')}
        </Link>
      </p>
    </form>
  )
}
