import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { userApi } from '@/api/user'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/common/PageHeader'
import { useAuthStore } from '@/stores/auth'

export function ProfilePage() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)

  const [nickname, setNickname] = useState(user?.nickname ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [avatar, setAvatar] = useState(user?.avatar ?? '')

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const profileMutation = useMutation({
    mutationFn: async () => {
      await userApi.updateProfile({
        nickname: nickname || undefined,
        email: email || undefined,
        avatar: avatar || undefined,
      })
      return userApi.getProfile()
    },
    onSuccess: (data) => {
      setUser(data)
      toast.success(t('user.profileUpdated'))
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t('common.failed'))
    },
  })

  const passwordMutation = useMutation({
    mutationFn: () => userApi.changePassword({ oldPassword, newPassword }),
    onSuccess: () => {
      toast.success(t('user.passwordChanged'))
      setOldPassword('')
      setNewPassword('')
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t('common.failed'))
    },
  })

  return (
    <div>
      <PageHeader title={t('user.profile')} description={t('user.profileDesc')} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('user.profile')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                profileMutation.mutate()
              }}
            >
              <div className="space-y-2">
                <Label>{t('auth.username')}</Label>
                <Input value={user?.username ?? ''} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nickname">{t('user.nickname')}</Label>
                <Input
                  id="nickname"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="avatar">{t('user.avatar')}</Label>
                <Input
                  id="avatar"
                  value={avatar}
                  onChange={(event) => setAvatar(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={profileMutation.isPending}>
                {t('user.saveProfile')}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('user.changePassword')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                passwordMutation.mutate()
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="oldPassword">{t('user.oldPassword')}</Label>
                <Input
                  id="oldPassword"
                  type="password"
                  value={oldPassword}
                  onChange={(event) => setOldPassword(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">{t('user.newPassword')}</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">{t('auth.passwordHint')}</p>
              </div>
              <Button type="submit" disabled={passwordMutation.isPending}>
                {t('user.changePassword')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
