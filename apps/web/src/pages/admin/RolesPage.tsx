import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi } from '@/api/admin'
import type { RoleItem } from '@/api/types'
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

interface RoleForm {
  name: string
  code: string
  description: string
}

export function RolesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<RoleForm>({ name: '', code: '', description: '' })
  const [editing, setEditing] = useState<RoleItem | null>(null)
  const [permsTarget, setPermsTarget] = useState<RoleItem | null>(null)
  const [selectedPerms, setSelectedPerms] = useState<string[]>([])

  const { data: roles, isLoading } = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: adminApi.listRoles,
  })
  const { data: permissions } = useQuery({
    queryKey: ['admin', 'permissions'],
    queryFn: adminApi.listPermissions,
  })

  const grouped = useMemo(() => {
    const map = new Map<string, { code: string; name: string }[]>()
    for (const item of permissions ?? []) {
      const list = map.get(item.resource) ?? []
      list.push({ code: item.code, name: item.name })
      map.set(item.resource, list)
    }
    return Array.from(map.entries())
  }, [permissions])

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] })

  const onError = (error: unknown) =>
    toast.error(error instanceof ApiError ? error.message : t('common.failed'))

  const createMutation = useMutation({
    mutationFn: () =>
      adminApi.createRole({
        name: form.name,
        code: form.code,
        description: form.description || undefined,
      }),
    onSuccess: () => {
      toast.success(t('common.success'))
      setCreateOpen(false)
      setForm({ name: '', code: '', description: '' })
      invalidate()
    },
    onError,
  })

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('no target')
      return adminApi.updateRole(editing.id, {
        name: editing.name,
        description: editing.description ?? undefined,
      })
    },
    onSuccess: () => {
      toast.success(t('common.success'))
      setEditing(null)
      invalidate()
    },
    onError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteRole(id),
    onSuccess: () => {
      toast.success(t('common.success'))
      invalidate()
    },
    onError,
  })

  const permsMutation = useMutation({
    mutationFn: () => {
      if (!permsTarget) throw new Error('no target')
      return adminApi.assignPermissions(permsTarget.id, selectedPerms)
    },
    onSuccess: () => {
      toast.success(t('common.success'))
      setPermsTarget(null)
      invalidate()
    },
    onError,
  })

  const openPerms = async (role: RoleItem) => {
    setPermsTarget(role)
    try {
      const detail = await adminApi.getRole(role.id)
      setSelectedPerms(detail.permissionCodes)
    } catch {
      setSelectedPerms([])
    }
  }

  return (
    <div>
      <PageHeader
        title={t('admin.roles')}
        description={t('admin.rolesDesc')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('admin.createRole')}
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <Loading />
          ) : !roles || roles.length === 0 ? (
            <EmptyState title={t('common.noData')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.roleName')}</TableHead>
                  <TableHead>{t('admin.roleCode')}</TableHead>
                  <TableHead>{t('admin.permissionCount')}</TableHead>
                  <TableHead>{t('admin.userCount')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell>
                      <span className="flex items-center gap-2 font-medium">
                        {role.name}
                        {role.isSystem === 1 ? (
                          <Badge variant="outline">{t('admin.systemRole')}</Badge>
                        ) : null}
                      </span>
                      {role.description ? (
                        <p className="text-xs text-muted-foreground">{role.description}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{role.code}</TableCell>
                    <TableCell>{role.permissionCount}</TableCell>
                    <TableCell>{role.userCount}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('admin.assignPermissions')}
                          onClick={() => void openPerms(role)}
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('common.edit')}
                          onClick={() => setEditing({ ...role })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          disabled={role.isSystem === 1}
                          title={t('common.delete')}
                          onClick={() => {
                            if (window.confirm(t('admin.deleteRoleConfirm'))) {
                              deleteMutation.mutate(role.id)
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
          )}
        </CardContent>
      </Card>

      {/* 新建角色 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.createRole')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('admin.roleName')}</Label>
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('admin.roleCode')}</Label>
              <Input
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
                placeholder="custom_role"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('admin.description')}</Label>
              <Input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={createMutation.isPending || !form.name || !form.code}
              onClick={() => createMutation.mutate()}
            >
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑角色 */}
      <Dialog open={editing !== null} onOpenChange={() => setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.editRole')}</DialogTitle>
            <DialogDescription className="font-mono">{editing?.code}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t('admin.roleName')}</Label>
              <Input
                value={editing?.name ?? ''}
                onChange={(event) =>
                  setEditing((prev) => (prev ? { ...prev, name: event.target.value } : prev))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{t('admin.description')}</Label>
              <Input
                value={editing?.description ?? ''}
                onChange={(event) =>
                  setEditing((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                }
              />
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

      {/* 分配权限 */}
      <Dialog open={permsTarget !== null} onOpenChange={() => setPermsTarget(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('admin.assignPermissions')}</DialogTitle>
            <DialogDescription>{permsTarget?.name}</DialogDescription>
          </DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedPerms((permissions ?? []).map((item) => item.code))}
            >
              {t('admin.selectAll')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSelectedPerms([])}>
              {t('admin.clearAll')}
            </Button>
          </div>
          <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            {grouped.map(([resource, items]) => (
              <div key={resource} className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {resource}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {items.map((item) => (
                    <label key={item.code} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-input"
                        checked={selectedPerms.includes(item.code)}
                        onChange={(event) => {
                          setSelectedPerms((prev) =>
                            event.target.checked
                              ? [...prev, item.code]
                              : prev.filter((code) => code !== item.code),
                          )
                        }}
                      />
                      <span className="truncate" title={item.code}>
                        {item.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermsTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={permsMutation.isPending} onClick={() => permsMutation.mutate()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
