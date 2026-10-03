import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { adminApi, type ConfigItemPayload } from '@/api/admin'
import type { SiteConfigVo } from '@/api/types'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/common/EmptyState'
import { Loading } from '@/components/common/Loading'
import { PageHeader } from '@/components/common/PageHeader'

type ValueType = 'boolean' | 'number' | 'string' | 'json'

function valueType(value: unknown): ValueType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (value !== null && typeof value === 'object') return 'json'
  return 'string'
}

function serialize(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

function resolveValue(original: unknown, edited: unknown): unknown {
  const type = valueType(original)
  if (type === 'boolean') return Boolean(edited)
  if (type === 'number') return Number(edited)
  if (type === 'json') {
    if (typeof edited !== 'string') return edited
    try {
      return JSON.parse(edited) as unknown
    } catch {
      return original
    }
  }
  return typeof edited === 'string' ? edited : String(edited)
}

const UPLOADABLE_KEYS = new Set(['logo', 'favicon'])

export interface ConfigGroupAction {
  label: string
  placeholder: string
  run: (value: string) => Promise<string>
}

export interface ConfigEditorProps {
  title: string
  description: string
  queryKey: string
  fetchConfig: () => Promise<{ items: SiteConfigVo[] }>
  updateConfig: (group: string, items: ConfigItemPayload[]) => Promise<{ count: number }>
  /** 上传文件并返回可访问 URL（用于 logo / favicon 等） */
  uploadFile?: (file: File) => Promise<{ url: string }>
  /** 分组级测试动作，键为分组名 */
  groupActions?: Record<string, ConfigGroupAction>
}

/** 分组 KV 配置编辑器（站点配置 / 系统配置共用） */
export function ConfigEditor({
  title,
  description,
  queryKey,
  fetchConfig,
  updateConfig,
  uploadFile,
  groupActions,
}: ConfigEditorProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [activeGroup, setActiveGroup] = useState('')
  const [edits, setEdits] = useState<Record<string, unknown>>({})
  const [actionInput, setActionInput] = useState('')
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const { data, isLoading } = useQuery({ queryKey: ['admin', queryKey], queryFn: fetchConfig })

  const groups = useMemo(() => {
    const map = new Map<string, SiteConfigVo[]>()
    for (const item of data?.items ?? []) {
      const list = map.get(item.groupKey) ?? []
      list.push(item)
      map.set(item.groupKey, list)
    }
    return Array.from(map.entries()).map(([key, items]) => ({ key, items }))
  }, [data])

  const currentGroup = activeGroup || groups[0]?.key || ''
  const currentItems = groups.find((group) => group.key === currentGroup)?.items ?? []
  const changedCount = currentItems.filter((item) => item.configKey in edits).length

  const saveMutation = useMutation({
    mutationFn: () => {
      const items: ConfigItemPayload[] = currentItems
        .filter((item) => item.configKey in edits)
        .map((item) => ({
          configKey: item.configKey,
          configValue: resolveValue(item.configValue, edits[item.configKey]),
          description: item.description ?? undefined,
        }))
      return updateConfig(currentGroup, items)
    },
    onSuccess: () => {
      toast.success(t('common.success'))
      setEdits({})
      void queryClient.invalidateQueries({ queryKey: ['admin', queryKey] })
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : t('common.failed')),
  })

  const action = groupActions?.[currentGroup]

  const actionMutation = useMutation({
    mutationFn: () => {
      if (!action) throw new ApiError(0, t('common.failed'))
      return action.run(actionInput)
    },
    onSuccess: (message) => {
      toast.success(message || t('common.success'))
      setActionInput('')
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : t('common.failed')),
  })

  const setEdit = (key: string, value: unknown) =>
    setEdits((prev) => ({ ...prev, [key]: value }))

  const handleUpload = async (key: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !uploadFile) return
    setUploadingKey(key)
    try {
      const { url } = await uploadFile(file)
      setEdit(key, url)
      toast.success(t('admin.uploadSuccess'))
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('common.failed'))
    } finally {
      setUploadingKey(null)
    }
  }

  return (
    <div>
      <PageHeader title={title} description={description} />

      {isLoading ? (
        <Loading />
      ) : groups.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState title={t('common.noData')} />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Tabs
              value={currentGroup}
              onValueChange={(value) => {
                setActiveGroup(value)
                setEdits({})
                setActionInput('')
              }}
              items={groups.map((group) => ({ value: group.key, label: group.key }))}
            />
            <div className="flex flex-wrap items-center gap-2">
              {action ? (
                <>
                  <Input
                    className="w-56"
                    placeholder={action.placeholder}
                    value={actionInput}
                    onChange={(event) => setActionInput(event.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={!actionInput || actionMutation.isPending}
                    onClick={() => actionMutation.mutate()}
                  >
                    {action.label}
                  </Button>
                </>
              ) : null}
              <Button
                disabled={changedCount === 0 || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                {changedCount > 0
                  ? t('admin.saveChanges', { count: changedCount })
                  : t('admin.noChanges')}
              </Button>
            </div>
          </div>

          <Card>
            <CardContent>
              {currentItems.map((item) => {
                const type = valueType(item.configValue)
                const current =
                  item.configKey in edits ? edits[item.configKey] : item.configValue
                return (
                  <div
                    key={item.configKey}
                    className="grid gap-2 border-b py-4 last:border-b-0 sm:grid-cols-[18rem_1fr] sm:items-start"
                  >
                    <div className="space-y-1">
                      <Label className="font-mono text-xs">{item.configKey}</Label>
                      {item.description ? (
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      ) : null}
                    </div>
                    <div>
                      {type === 'boolean' ? (
                        <Switch
                          checked={Boolean(current)}
                          onCheckedChange={(checked) => setEdit(item.configKey, checked)}
                        />
                      ) : type === 'number' ? (
                        <Input
                          type="number"
                          value={serialize(current)}
                          onChange={(event) => setEdit(item.configKey, event.target.value)}
                        />
                      ) : type === 'json' ? (
                        <Textarea
                          className="font-mono text-xs"
                          value={typeof current === 'string' ? current : serialize(current)}
                          onChange={(event) => setEdit(item.configKey, event.target.value)}
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <Input
                            value={serialize(current)}
                            onChange={(event) => setEdit(item.configKey, event.target.value)}
                          />
                          {uploadFile && UPLOADABLE_KEYS.has(item.configKey) ? (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={uploadingKey === item.configKey}
                                onClick={() => fileInputRefs.current[item.configKey]?.click()}
                              >
                                {t('admin.upload')}
                              </Button>
                              <input
                                ref={(element) => {
                                  fileInputRefs.current[item.configKey] = element
                                }}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(event) => void handleUpload(item.configKey, event)}
                              />
                            </>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

export function SiteConfigPage() {
  const { t } = useTranslation()
  return (
    <ConfigEditor
      title={t('admin.siteConfig')}
      description={t('admin.siteConfigDesc')}
      queryKey="site-config"
      fetchConfig={adminApi.getSiteConfig}
      updateConfig={adminApi.updateSiteConfig}
      uploadFile={adminApi.uploadSiteConfigFile}
      groupActions={{
        email: {
          label: t('admin.testEmail'),
          placeholder: t('admin.emailPlaceholder'),
          run: async (to) => {
            const result = await adminApi.testEmail(to)
            return t('admin.testEmailSent', { to: result.to })
          },
        },
        sms: {
          label: t('admin.testSms'),
          placeholder: t('admin.smsPlaceholder'),
          run: async (to) => {
            const result = await adminApi.testSms(to)
            return result.simulated ? t('admin.testSmsSimulated') : t('admin.testSmsSent', { to })
          },
        },
      }}
    />
  )
}
