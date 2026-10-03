import { useTranslation } from 'react-i18next'
import { adminApi } from '@/api/admin'
import { ConfigEditor } from './SiteConfigPage'

export function SystemConfigPage() {
  const { t } = useTranslation()
  return (
    <ConfigEditor
      title={t('admin.systemConfig')}
      description={t('admin.systemConfigDesc')}
      queryKey="system-config"
      fetchConfig={adminApi.getSystemConfig}
      updateConfig={adminApi.updateSystemConfig}
    />
  )
}
