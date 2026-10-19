import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/api/client'
import { userApi } from '@/api/user'
import type { CreatedApiKey } from '@/api/types'
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
import { Switch } from '@/components/ui/switch'
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
import { ConfirmAction } from '@/components/common/ConfirmAction'

const QUERY_KEY = ['user', 'api-keys']

export function ApiKeysPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<CreatedApiKey | null>(null)

  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: userApi.listApiKeys })

  const createMutation = useMutation({
    mutationFn: () => userApi.createApiKey({ name }),
    onSuccess: (result) => {
      setCreated(result)
      setCreateOpen(false)
      setName('')
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.failed')),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: number }) =>
      userApi.updateApiKey(id, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.failed')),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => userApi.removeApiKey(id),
    onSuccess: () => {
      toast.success(t('common.success'))
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : t('common.failed')),
  })

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value)
    toast.success(t('common.copied'))
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={t('user.apiKeys')}
        description={t('user.apiKeysDesc')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>

            {t('user.createApiKey')}
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <Loading />
          ) : !data || data.length === 0 ? (
            <EmptyState title={t('common.noData')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('user.keyName')}</TableHead>
                  <TableHead>{t('user.accessKey')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('user.lastUsedAt')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">

                        {item.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => void copy(item.accessKey)}
                        className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
                      >
                        {item.accessKey}

                      </button>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={item.status === 1}
                        onCheckedChange={(checked) =>
                          toggleMutation.mutate({ id: item.id, status: checked ? 1 : 0 })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.lastUsedAt
                        ? new Date(item.lastUsedAt).toLocaleString()
                        : t('user.neverUsed')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="data-actions">
                      <ConfirmAction title={t('common.delete')} description={t('user.deleteKeyConfirm')} onConfirm={() => removeMutation.mutate(item.id)}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={removeMutation.isPending}
                          aria-label={t('common.delete')}
                        ><Trash2 className="h-4 w-4" /></Button>
                      </ConfirmAction>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('user.createApiKey')}</DialogTitle>
            <DialogDescription>{t('user.apiKeysDesc')}</DialogDescription>
          </DialogHeader>
          <div className="form-field">
            <Label htmlFor="keyName">{t('user.keyName')}</Label>
            <Input
              id="keyName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="production"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!name || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={created !== null} onOpenChange={() => setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('user.secretKey')}</DialogTitle>
            <DialogDescription>{t('user.secretTip')}</DialogDescription>
          </DialogHeader>
          {created ? (
            <div className="form-grid">
              <div className="form-field">
                <Label>{t('user.accessKey')}</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={created.accessKey} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => void copy(created.accessKey)} aria-label={t('common.copy')}><Copy className="h-4 w-4" />

                  </Button>
                </div>
              </div>
              <div className="form-field">
                <Label>{t('user.secretKey')}</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={created.secretKey} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => void copy(created.secretKey)} aria-label={t('common.copy')}><Copy className="h-4 w-4" />

                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
