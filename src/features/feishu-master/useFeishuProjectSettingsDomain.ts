import { computed, ref } from 'vue'
import type { FeishuProjectSettingsApi, FeishuProjectSettingsDto } from '@/services/kbApiServices'

function cloneSettings<T>(value: T): T {
  return JSON.parse(JSON.stringify(value || {})) as T
}

function buildEmptySettings(): FeishuProjectSettingsDto {
  return {
    mode: 'default',
    modeResolved: 'default',
    defaultConfig: {
      mcpUrl: '',
      projectKey: '',
      tokenMasked: '',
      tokenAvailable: false,
    },
    customConfig: {
      token: '',
      tokenMasked: '',
      tokenAvailable: false,
      projectKey: '',
    },
    effectiveConfig: {
      mode: 'default',
      mcpUrl: '',
      projectKey: '',
      tokenMasked: '',
      tokenAvailable: false,
    },
  }
}

interface UseFeishuProjectSettingsDomainOptions {
  service: FeishuProjectSettingsApi
  notify: (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void
  onSaved?: (settings: FeishuProjectSettingsDto) => void | Promise<void>
}

export function useFeishuProjectSettingsDomain(options: UseFeishuProjectSettingsDomainOptions) {
  const feishuProjectSettingsOpen = ref(false)
  const feishuProjectSettingsLoading = ref(false)
  const feishuProjectSettingsSaving = ref(false)
  const feishuProjectSettingsError = ref('')
  const feishuProjectSettings = ref<FeishuProjectSettingsDto>(buildEmptySettings())
  const feishuProjectSettingsDraft = ref<FeishuProjectSettingsDto>(buildEmptySettings())

  const feishuProjectSettingsModeLabel = computed(() =>
    feishuProjectSettings.value.effectiveConfig.mode === 'custom' ? '自定义 Token' : '默认配置',
  )

  async function loadFeishuProjectSettings() {
    feishuProjectSettingsLoading.value = true
    feishuProjectSettingsError.value = ''
    try {
      const result = await options.service.fetchSettings()
      const settings = result?.settings || buildEmptySettings()
      feishuProjectSettings.value = cloneSettings(settings)
      feishuProjectSettingsDraft.value = cloneSettings(settings)
    } catch (error) {
      feishuProjectSettingsError.value = String(error)
      options.notify(feishuProjectSettingsError.value, 'danger')
    } finally {
      feishuProjectSettingsLoading.value = false
    }
  }

  async function openFeishuProjectSettings() {
    feishuProjectSettingsOpen.value = true
    if (!feishuProjectSettings.value.defaultConfig.mcpUrl && !feishuProjectSettingsLoading.value) {
      await loadFeishuProjectSettings()
      return
    }
    feishuProjectSettingsDraft.value = cloneSettings(feishuProjectSettings.value)
    feishuProjectSettingsError.value = ''
  }

  function closeFeishuProjectSettings() {
    if (feishuProjectSettingsSaving.value) return
    feishuProjectSettingsOpen.value = false
    feishuProjectSettingsError.value = ''
    feishuProjectSettingsDraft.value = cloneSettings(feishuProjectSettings.value)
  }

  function resetFeishuProjectSettingsDraft() {
    feishuProjectSettingsDraft.value = cloneSettings(feishuProjectSettings.value)
    feishuProjectSettingsError.value = ''
  }

  async function saveFeishuProjectSettings() {
    feishuProjectSettingsSaving.value = true
    feishuProjectSettingsError.value = ''
    try {
      const payload = {
        mode: feishuProjectSettingsDraft.value.mode,
        customConfig: {
          token: String(feishuProjectSettingsDraft.value.customConfig.token || '').trim(),
          projectKey: String(feishuProjectSettingsDraft.value.customConfig.projectKey || '').trim(),
        },
      }
      const result = await options.service.saveSettings(payload)
      const settings = result?.settings || buildEmptySettings()
      feishuProjectSettings.value = cloneSettings(settings)
      feishuProjectSettingsDraft.value = cloneSettings(settings)
      options.notify(
        settings.effectiveConfig.mode === 'custom' ? '已切换到自定义飞书 Token' : '已切换到默认飞书配置',
        'success',
      )
      if (options.onSaved) await options.onSaved(settings)
      feishuProjectSettingsOpen.value = false
    } catch (error) {
      feishuProjectSettingsError.value = String(error)
      options.notify(feishuProjectSettingsError.value, 'danger')
    } finally {
      feishuProjectSettingsSaving.value = false
    }
  }

  return {
    feishuProjectSettingsOpen,
    feishuProjectSettingsLoading,
    feishuProjectSettingsSaving,
    feishuProjectSettingsError,
    feishuProjectSettings,
    feishuProjectSettingsDraft,
    feishuProjectSettingsModeLabel,
    loadFeishuProjectSettings,
    openFeishuProjectSettings,
    closeFeishuProjectSettings,
    resetFeishuProjectSettingsDraft,
    saveFeishuProjectSettings,
  }
}
