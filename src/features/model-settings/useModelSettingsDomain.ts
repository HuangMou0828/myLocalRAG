import { computed, ref } from 'vue'
import type { ModelCapabilityDto, ModelSettingsDto, ModelSettingsApi } from '@/services/kbApiServices'

function cloneSettings<T>(value: T): T {
  return JSON.parse(JSON.stringify(value || {})) as T
}

function buildEmptySettings(): ModelSettingsDto {
  return {
    assistant: {
      apiBase: '',
      apiKey: '',
      model: '',
      timeoutMs: 60000,
      temperature: 0.2,
      topP: 1,
      maxTokens: 0,
      dueDate: '',
    },
    embedding: {
      apiBase: '',
      apiKey: '',
      model: '',
      timeoutMs: 20000,
      maxBatch: 5,
      dimensions: 1024,
      dueDate: '',
    },
    dspy: {
      inheritFromAssistant: true,
      provider: 'openai',
      apiBase: '',
      apiKey: '',
      model: '',
      timeoutMs: 90000,
      dueDate: '',
    },
  }
}

interface UseModelSettingsDomainOptions {
  service: ModelSettingsApi
  notify: (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void
}

type ModelOwner = 'assistant' | 'embedding' | 'dspy'

interface ModelManagementItem {
  id: string
  title: string
  subtitle: string
  enabled: boolean
  avatarText: string
  owners: string[]
  ownerKeys: ModelOwner[]
  capabilityTitles: string[]
  paths: string[]
  configTags: string[]
  dueDateTags: string[]
  description: string
  apiBase: string
  apiBaseHost: string
  apiKeyMasked: string
}

interface ModelSettingsTestResultItem {
  owner: ModelOwner
  ok: boolean
  model: string
  apiBase: string
  detail: string
}

function maskSecret(secret: string): string {
  const value = String(secret || '').trim()
  if (!value) return ''
  if (value.length <= 8) return `${value.slice(0, 2)}***`
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}

function getApiBaseHost(apiBase: string): string {
  const input = String(apiBase || '').trim()
  if (!input) return ''
  try {
    return new URL(input).host || input
  } catch {
    return input.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  }
}

function getOwnerLabel(owner: ModelOwner): string {
  if (owner === 'assistant') return 'Assistant'
  if (owner === 'embedding') return 'Embedding'
  return 'DSPy'
}

function getAvatarText(model: string): string {
  const compact = String(model || '').trim()
  if (!compact) return 'ML'
  const pieces = compact
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
  const text = (pieces.join('').slice(0, 3) || compact.slice(0, 3)).toUpperCase()
  return text
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter((item) => String(item || '').trim().length > 0))]
}

export function useModelSettingsDomain(options: UseModelSettingsDomainOptions) {
  const modelSettingsOpen = ref(false)
  const modelSettingsLoading = ref(false)
  const modelSettingsSaving = ref(false)
  const modelSettings = ref<ModelSettingsDto>(buildEmptySettings())
  const modelSettingsDraft = ref<ModelSettingsDto>(buildEmptySettings())
  const modelCapabilities = ref<ModelCapabilityDto[]>([])
  const selectedModelSettingsItemId = ref('')
  const modelSettingsTesting = ref(false)
  const modelSettingsTestResults = ref<ModelSettingsTestResultItem[]>([])

  const enabledCapabilityCount = computed(() =>
    modelCapabilities.value.filter((item) => item.enabled).length,
  )

  const modelManagementItems = computed<ModelManagementItem[]>(() => {
    const settings = modelSettings.value || buildEmptySettings()
    const sourceEntries = [
      {
        owner: 'assistant' as const,
        model: String(settings.assistant.model || '').trim(),
        apiBase: String(settings.assistant.apiBase || '').trim(),
        apiKeyMasked: String(settings.assistant.apiKeyMasked || maskSecret(settings.assistant.apiKey)),
        enabled: Boolean(settings.assistant.model && settings.assistant.apiBase && settings.assistant.apiKey),
        configTags: [
          `超时 ${settings.assistant.timeoutMs}ms`,
          `Temperature ${settings.assistant.temperature}`,
          `Top P ${settings.assistant.topP}`,
          settings.assistant.maxTokens > 0 ? `Max Tokens ${settings.assistant.maxTokens}` : 'Max Tokens 默认',
        ],
        dueDate: String(settings.assistant.dueDate || '').trim(),
      },
      {
        owner: 'embedding' as const,
        model: String(settings.embedding.model || '').trim(),
        apiBase: String(settings.embedding.apiBase || '').trim(),
        apiKeyMasked: String(settings.embedding.apiKeyMasked || maskSecret(settings.embedding.apiKey)),
        enabled: Boolean(settings.embedding.model && settings.embedding.apiBase && settings.embedding.apiKey),
        configTags: [
          `超时 ${settings.embedding.timeoutMs}ms`,
          `批大小 ${settings.embedding.maxBatch}`,
          settings.embedding.dimensions > 0 ? `维度 ${settings.embedding.dimensions}` : '维度 默认',
        ],
        dueDate: String(settings.embedding.dueDate || '').trim(),
      },
      {
        owner: 'dspy' as const,
        model: String(settings.dspy.model || '').trim(),
        apiBase: String(settings.dspy.apiBase || '').trim(),
        apiKeyMasked: String(settings.dspy.apiKeyMasked || maskSecret(settings.dspy.apiKey)),
        enabled: Boolean(settings.dspy.model && settings.dspy.apiBase && settings.dspy.apiKey),
        configTags: [
          `Provider ${String(settings.dspy.provider || 'openai')}`,
          `超时 ${settings.dspy.timeoutMs}ms`,
          settings.dspy.inheritFromAssistant ? '继承 Assistant' : '独立配置',
        ],
        dueDate: String(settings.dspy.dueDate || '').trim(),
      },
    ].filter((item) => item.model || item.apiBase || item.apiKeyMasked)

    const capabilityByOwner = new Map<ModelOwner, ModelCapabilityDto[]>(
      (['assistant', 'embedding', 'dspy'] as ModelOwner[]).map((owner) => [
        owner,
        modelCapabilities.value.filter((item) => item.owner === owner),
      ]),
    )

    const grouped = new Map<string, ModelManagementItem>()

    sourceEntries.forEach((entry) => {
      const itemKey = `${entry.model}::${entry.apiBase}::${entry.apiKeyMasked}` || entry.owner
      const apiBaseHost = getApiBaseHost(entry.apiBase)
      const ownerCapabilities = capabilityByOwner.get(entry.owner) || []
      const capabilityTitles = ownerCapabilities.map((item) => item.title)
      const capabilityPaths = ownerCapabilities.flatMap((item) => item.paths || [])
      const group = grouped.get(itemKey)
      if (group) {
        group.enabled = group.enabled || entry.enabled
        group.owners = uniq([...group.owners, getOwnerLabel(entry.owner)])
        group.ownerKeys = [...new Set([...group.ownerKeys, entry.owner])]
        group.capabilityTitles = uniq([...group.capabilityTitles, ...capabilityTitles])
        group.paths = uniq([...group.paths, ...capabilityPaths])
        group.configTags = uniq([...group.configTags, ...entry.configTags])
        group.dueDateTags = uniq([...group.dueDateTags, entry.dueDate ? `${getOwnerLabel(entry.owner)} 截止 ${entry.dueDate}` : ''])
        group.description = `当前承担 ${group.capabilityTitles.join('、') || group.owners.join('、')}`
        return
      }

      grouped.set(itemKey, {
        id: itemKey,
        title: entry.model || `${getOwnerLabel(entry.owner)} 未配置`,
        subtitle: apiBaseHost || '未配置 API Base',
        enabled: entry.enabled,
        avatarText: getAvatarText(entry.model || getOwnerLabel(entry.owner)),
        owners: [getOwnerLabel(entry.owner)],
        ownerKeys: [entry.owner],
        capabilityTitles,
        paths: uniq(capabilityPaths),
        configTags: uniq(entry.configTags),
        dueDateTags: uniq(entry.dueDate ? [`${getOwnerLabel(entry.owner)} 截止 ${entry.dueDate}`] : []),
        description: `当前承担 ${capabilityTitles.join('、') || getOwnerLabel(entry.owner)}`,
        apiBase: entry.apiBase,
        apiBaseHost,
        apiKeyMasked: entry.apiKeyMasked,
      })
    })

    return [...grouped.values()].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      if (a.owners.length !== b.owners.length) return b.owners.length - a.owners.length
      return a.title.localeCompare(b.title)
    })
  })

  const selectedModelSettingsItem = computed<ModelManagementItem | null>(() => {
    const items = modelManagementItems.value
    if (!items.length) return null
    if (!selectedModelSettingsItemId.value) return items[0]
    return items.find((item) => item.id === selectedModelSettingsItemId.value) || items[0]
  })

  async function loadModelSettings() {
    modelSettingsLoading.value = true
    try {
      const result = await options.service.fetchSettings()
      modelSettings.value = cloneSettings(result.settings || buildEmptySettings())
      modelSettingsDraft.value = cloneSettings(result.settings || buildEmptySettings())
      modelCapabilities.value = Array.isArray(result.capabilities) ? result.capabilities : []
    } finally {
      modelSettingsLoading.value = false
    }
  }

  function openModelSettings(item?: ModelManagementItem | null) {
    selectedModelSettingsItemId.value = String(item?.id || selectedModelSettingsItem.value?.id || '')
    modelSettingsTestResults.value = []
    modelSettingsOpen.value = true
    void loadModelSettings()
  }

  function closeModelSettings() {
    if (modelSettingsSaving.value) return
    modelSettingsOpen.value = false
    modelSettingsTestResults.value = []
  }

  async function saveModelSettings() {
    modelSettingsSaving.value = true
    try {
      const result = await options.service.saveSettings(cloneSettings(modelSettingsDraft.value))
      modelSettings.value = cloneSettings(result.settings || buildEmptySettings())
      modelSettingsDraft.value = cloneSettings(result.settings || buildEmptySettings())
      modelCapabilities.value = Array.isArray(result.capabilities) ? result.capabilities : []
      options.notify('模型配置已保存，系统后续请求将使用新配置', 'success')
      modelSettingsOpen.value = false
    } finally {
      modelSettingsSaving.value = false
    }
  }

  function resetModelSettingsDraft() {
    modelSettingsDraft.value = cloneSettings(modelSettings.value)
    modelSettingsTestResults.value = []
  }

  async function testSelectedModelSettings() {
    const item = selectedModelSettingsItem.value
    if (!item) return
    modelSettingsTesting.value = true
    modelSettingsTestResults.value = []
    try {
      const result = await options.service.testSettings({
        settings: cloneSettings(modelSettingsDraft.value),
        owners: item.ownerKeys,
      })
      modelSettingsTestResults.value = Array.isArray(result.results) ? result.results : []
      const allPassed = modelSettingsTestResults.value.every((entry) => entry.ok)
      options.notify(allPassed ? '网关连通性测试通过' : '网关连通性测试已返回，请查看结果', allPassed ? 'success' : 'warning')
    } finally {
      modelSettingsTesting.value = false
    }
  }

  return {
    modelSettingsOpen,
    modelSettingsLoading,
    modelSettingsSaving,
    modelSettings,
    modelSettingsDraft,
    modelCapabilities,
    enabledCapabilityCount,
    modelManagementItems,
    selectedModelSettingsItem,
    modelSettingsTesting,
    modelSettingsTestResults,
    loadModelSettings,
    openModelSettings,
    closeModelSettings,
    saveModelSettings,
    resetModelSettingsDraft,
    testSelectedModelSettings,
  }
}
