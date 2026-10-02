import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, KeyRound, Pencil, Plus, RotateCcw, Search, Trash2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { RoleType, UserStatus } from '@lunar/shared'
import { adminApi } from '@/api/admin'
import type { AdminUserItem } from '@/api/types'
import { ApiError } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/common/EmptyState'
import { Loading } from '@/components/common/Loading'
import { PageHeader } from '@/components/common/PageHeader'
import { Pagination } from '@/components/common/Pagination'
import { StatusBadge } from '@/components/common/StatusBadge'

const PAGE_SIZE = 10

const ROLE_TYPE_KEYS: Record<number, string> = {
  [RoleType.USER]: 'roleType.user',
  [RoleType.ADMIN]: 'roleType.admin',
  [RoleType.SUPER_ADMIN]: 'roleType.superAdmin',
}

interface CreateForm {
  username: string
  password: string
  email: string
  nickname: string
  roleType: number
}

interface EditForm {
  nickname: string
  email: string
  phone: string
  status: number
  roleType: number
}

export function UsersPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [roleTypeFilter, setRoleTypeFilter] = useState<string>('')

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>({
    username: '',
    password: '',
    email: '',
    nickname: '',
    roleType: RoleType.USER,
  })

  const [editing, setEditing] = useState<AdminUserItem | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({
    nickname: '',
    email: '',
    phone: '',
    status: UserStatus.ACTIVE,
    roleType: RoleType.USER,
  })

  const [balanceTarget, setBalanceTarget] = useState<AdminUserItem | null>(null)
  const [balanceAmount, setBalanceAmount] = useState('')
  const [balanceRemark, setBalanceRemark] = useState('')

  const [rolesTarget, setRolesTarget] = useState<AdminUserItem | null>(null)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', page, appliedKeyword, statusFilter, roleTypeFilter],
    queryFn: () =>
      adminApi.listUsers({
        page,
        pageSize: PAGE_SIZE,
        keyword: appliedKeyword || undefined,
        status: statusFilter === '' ? undefined : Number(statusFilter),
        roleType: roleTypeFilter === '' ? undefined : Number(roleTypeFilter),
      }),
  })

  const { data: roles } = useQuery({ queryKey: ['admin', 'roles'], queryFn: adminApi.listRoles })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })

  const onError = (error: unknown) =>
    toast.error(error instanceof ApiError ? error.message : t('common.failed'))

  const createMutation = useMutation({
    mutationFn: () =>
      adminApi.createUser({
        username: createForm.username,
        password: createForm.password,
        email: createForm.email || undefined,
        nickname: createForm.nickname || undefined,
        roleType: createForm.roleType as RoleType,
      }),
    onSuccess: () => {
      toast.success(t('common.success'))
      setCreateOpen(false)
      setCreateForm({
        username: '',
        password: '',
        email: '',
        nickname: '',
        roleType: RoleType.USER,
      })
      invalidate()
    },
    onError,
  })

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('no target')
      return adminApi.updateUser(editing.id, {
        nickname: editForm.nickname || undefined,
        email: editForm.email || undefined,
        phone: editForm.phone || undefined,
        status: editForm.status,
        roleType: editForm.roleType as RoleType,
      })
    },
    onSuccess: () => {
      toast.success(t('common.success'))
      setEditing(null)
      invalidate()
    },
    onError,
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, ban }: { id: string; ban: boolean }) =>
      ban ? adminApi.banUser(id) : adminApi.unbanUser(id),
    onSuccess: () => {
      toast.success(t('common.success'))
      invalidate()
    },
    onError,
  })

  const resetMutation = useMutation({
    mutationFn: (id: string) => adminApi.resetPassword(id),
    onSuccess: (result) => {
      toast.success(t('admin.newPasswordGenerated', { password: result.password }), {
        duration: 12_000,
      })
    },
    onError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => {
      toast.success(t('common.success'))
      invalidate()
    },
    onError,
  })

  const balanceMutation = useMutation({
    mutationFn: () => {
      if (!balanceTarget) throw new Error('no target')
      return adminApi.adjustBalance(balanceTarget.id, {
        amount: Number(balanceAmount),
        remark: balanceRemark || undefined,
      })
    },
    onSuccess: () => {
      toast.success(t('common.success'))
      setBalanceTarget(null)
      setBalanceAmount('')
      setBalanceRemark('')
      invalidate()
    },
    onError,
  })

  const rolesMutation = useMutation({
    mutationFn: () => {
      if (!rolesTarget) throw new Error('no target')
      return adminApi.assignUserRoles(rolesTarget.id, selectedRoles)
    },
    onSuccess: () => {
      toast.success(t('common.success'))
      setRolesTarget(null)
      invalidate()
    },
    onError,
  })

  return (
    <div>
      <PageHeader
        title={t('admin.users')}
        description={t('admin.usersDesc')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('admin.createUser')}
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex min-w-[12rem] flex-1 items-center gap-2">
            <Input
              placeholder={t('common.keyword')}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setPage(1)
                  setAppliedKeyword(keyword)
                }
              }}
            />
            <Button
              variant="outline"
              onClick={() => {
                setPage(1)
                setAppliedKeyword(keyword)
              }}
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
          <Select
            className="w-[9rem]"
            value={statusFilter}
            onChange={(event) => {
              setPage(1)
              setStatusFilter(event.target.value)
            }}
          >
            <option value="">{t('common.status')}: {t('common.all')}</option>
            <option value={String(UserStatus.ACTIVE)}>{t('status.active')}</option>
            <option value={String(UserStatus.DISABLED)}>{t('status.disabled')}</option>
            <option value={String(UserStatus.PENDING)}>{t('status.pending')}</option>
          </Select>
          <Select
            className="w-[9rem]"
            value={roleTypeFilter}
            onChange={(event) => {
              setPage(1)
              setRoleTypeFilter(event.target.value)
            }}
          >
            <option value="">{t('admin.roleType')}: {t('common.all')}</option>
            <option value={String(RoleType.USER)}>{t('roleType.user')}</option>
            <option value={String(RoleType.ADMIN)}>{t('roleType.admin')}</option>
            <option value={String(RoleType.SUPER_ADMIN)}>{t('roleType.superAdmin')}</option>
          </Select>
          <Button
            variant="ghost"
            onClick={() => {
              setKeyword('')
              setAppliedKeyword('')
              setStatusFilter('')
              setRoleTypeFilter('')
              setPage(1)
            }}
          >
            {t('common.reset')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <Loading />
          ) : !data || data.list.length === 0 ? (
            <EmptyState title={t('common.noData')} />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('auth.username')}</TableHead>
                    <TableHead>{t('admin.roleType')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('dashboard.balance')}</TableHead>
                    <TableHead>{t('admin.registeredAt')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.list.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="space-y-0.5">
                          <p className="font-medium">{user.username}</p>
                          <p className="text-xs text-muted-foreground">
                            {user.nickname ?? '-'} · {user.email ?? '-'}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.roleType === RoleType.USER ? 'secondary' : 'default'}>
                          {t(ROLE_TYPE_KEYS[user.roleType] ?? 'roleType.user')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={user.status} />
                      </TableCell>
                      <TableCell className="text-sm">¥ {user.balance}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('admin.editUser')}
                            onClick={() => {
                              setEditing(user)
                              setEditForm({
                                nickname: user.nickname ?? '',
                                email: user.email ?? '',
                                phone: user.phone ?? '',
                                status: user.status,
                                roleType: user.roleType,
                              })
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('admin.assignUserRoles')}
                            onClick={() => {
                              setRolesTarget(user)
                              setSelectedRoles(user.roles)
                            }}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('admin.adjustBalance')}
                            onClick={() => setBalanceTarget(user)}
                          >
                            <Wallet className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('admin.resetPassword')}
                            onClick={() => resetMutation.mutate(user.id)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={
                              user.status === UserStatus.DISABLED ? t('admin.unban') : t('admin.ban')
                            }
                            onClick={() =>
                              statusMutation.mutate({
                                id: user.id,
                                ban: user.status !== UserStatus.DISABLED,
                              })
                            }
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            title={t('common.delete')}
                            onClick={() => {
                              if (window.confirm(t('admin.deleteUserConfirm'))) {
                                deleteMutation.mutate(user.id)
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="px-4 pb-4">
                <Pagination
                  page={data.pagination.page}
                  pageSize={data.pagination.pageSize}
                  total={data.pagination.total}
                  onPageChange={setPage}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 新建用户 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.createUser')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('auth.username')}</Label>
              <Input
                value={createForm.username}
                onChange={(event) =>
                  setCreateForm({ ...createForm, username: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{t('auth.password')}</Label>
              <Input
                type="password"
                value={createForm.password}
                onChange={(event) =>
                  setCreateForm({ ...createForm, password: event.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">{t('auth.passwordHint')}</p>
            </div>
            <div className="space-y-2">
              <Label>{t('auth.email')}</Label>
              <Input
                type="email"
                value={createForm.email}
                onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('user.nickname')}</Label>
              <Input
                value={createForm.nickname}
                onChange={(event) =>
                  setCreateForm({ ...createForm, nickname: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{t('admin.roleType')}</Label>
              <Select
                value={createForm.roleType}
                onChange={(event) =>
                  setCreateForm({ ...createForm, roleType: Number(event.target.value) })
                }
              >
                <option value={RoleType.USER}>{t('roleType.user')}</option>
                <option value={RoleType.ADMIN}>{t('roleType.admin')}</option>
                <option value={RoleType.SUPER_ADMIN}>{t('roleType.superAdmin')}</option>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={createMutation.isPending || !createForm.username || !createForm.password}
              onClick={() => createMutation.mutate()}
            >
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑用户 */}
      <Dialog open={editing !== null} onOpenChange={() => setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.editUser')}</DialogTitle>
            <DialogDescription>{editing?.username}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('user.nickname')}</Label>
              <Input
                value={editForm.nickname}
                onChange={(event) => setEditForm({ ...editForm, nickname: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('auth.email')}</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('admin.phone')}</Label>
              <Input
                value={editForm.phone}
                onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('common.status')}</Label>
              <Select
                value={editForm.status}
                onChange={(event) =>
                  setEditForm({ ...editForm, status: Number(event.target.value) })
                }
              >
                <option value={UserStatus.ACTIVE}>{t('status.active')}</option>
                <option value={UserStatus.DISABLED}>{t('status.disabled')}</option>
                <option value={UserStatus.PENDING}>{t('status.pending')}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('admin.roleType')}</Label>
              <Select
                value={editForm.roleType}
                onChange={(event) =>
                  setEditForm({ ...editForm, roleType: Number(event.target.value) })
                }
              >
                <option value={RoleType.USER}>{t('roleType.user')}</option>
                <option value={RoleType.ADMIN}>{t('roleType.admin')}</option>
                <option value={RoleType.SUPER_ADMIN}>{t('roleType.superAdmin')}</option>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={updateMutation.isPending} onClick={() => updateMutation.mutate()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 调整余额 */}
      <Dialog open={balanceTarget !== null} onOpenChange={() => setBalanceTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.adjustBalance')}</DialogTitle>
            <DialogDescription>{balanceTarget?.username}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('admin.balanceAmount')}</Label>
              <Input
                type="number"
                step="0.01"
                value={balanceAmount}
                onChange={(event) => setBalanceAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('admin.remark')}</Label>
              <Input
                value={balanceRemark}
                onChange={(event) => setBalanceRemark(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBalanceTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!balanceAmount || balanceMutation.isPending}
              onClick={() => balanceMutation.mutate()}
            >
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 分配角色 */}
      <Dialog open={rolesTarget !== null} onOpenChange={() => setRolesTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.assignUserRoles')}</DialogTitle>
            <DialogDescription>{rolesTarget?.username}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {roles?.map((role) => (
              <label key={role.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={selectedRoles.includes(role.code)}
                  onChange={(event) => {
                    setSelectedRoles((prev) =>
                      event.target.checked
                        ? [...prev, role.code]
                        : prev.filter((code) => code !== role.code),
                    )
                  }}
                />
                {role.name}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRolesTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={selectedRoles.length === 0 || rolesMutation.isPending}
              onClick={() => rolesMutation.mutate()}
            >
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
