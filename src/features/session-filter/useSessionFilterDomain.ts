import { computed, type Ref } from 'vue'

export type TimeRangePreset = 'all' | 'today' | '7d' | '30d' | '90d'

interface SessionMessageLike {
  tags?: string[]
}

interface SessionLike {
  provider: string
  updatedAt: string
  messages: SessionMessageLike[]
}

interface ProviderCatalogItem {
  id: string
  label: string
}

interface UseSessionFilterDomainOptions<TSession extends SessionLike = SessionLike> {
  allSessions: Ref<TSession[]>
  activeProvider: { value: string }
  providerFilter: Ref<string>
  timeRangePreset: Ref<TimeRangePreset>
  tagFilter: Ref<string>
  cursorConversationIdFilter: Ref<string>
  presetTags: readonly string[]
  providerCatalog: ReadonlyArray<ProviderCatalogItem>
}

export function useSessionFilterDomain<TSession extends SessionLike = SessionLike>(
  options: UseSessionFilterDomainOptions<TSession>,
) {
  function resolveTimeRange(preset: TimeRangePreset) {
    if (preset === 'all') return { from: '', to: '' }

    const end = new Date()
    end.setHours(23, 59, 59, 999)

    const start = new Date()
    start.setHours(0, 0, 0, 0)

    if (preset === 'today') {
      return { from: start.toISOString(), to: end.toISOString() }
    }

    const offset = preset === '7d' ? 6 : preset === '30d' ? 29 : 89
    start.setDate(start.getDate() - offset)
    return { from: start.toISOString(), to: end.toISOString() }
  }

  function normalizeProviderId(provider: string): string {
    return String(provider || '').trim().toLowerCase()
  }

  function getProviderDisplayLabel(provider: string): string {
    const normalized = normalizeProviderId(provider)
    const found = options.providerCatalog.find((item) => item.id === normalized)
    if (found) return found.label
    return normalized ? normalized.toUpperCase() : 'Other'
  }

  const timeScopedSessions = computed(() => {
    const range = resolveTimeRange(options.timeRangePreset.value)
    const fromTs = range.from ? Date.parse(range.from) : 0
    const toTs = range.to ? Date.parse(range.to) : 0

    return options.allSessions.value.filter((item) => {
      const ts = Date.parse(String(item.updatedAt || ''))
      if (Number.isNaN(ts)) return true
      if (fromTs && ts < fromTs) return false
      if (toTs && ts > toTs) return false
      return true
    })
  })

  const filteredSessions = computed(() => {
    let list = timeScopedSessions.value

    if (options.activeProvider.value !== 'all') {
      list = list.filter((item) => String(item.provider || '').toLowerCase() === options.activeProvider.value)
    } else if (options.providerFilter.value) {
      list = list.filter((item) => String(item.provider || '').toLowerCase() === options.providerFilter.value)
    }

    if (options.tagFilter.value !== 'all') {
      list = list.filter((item) =>
        (item.messages || []).some((msg) => Array.isArray(msg.tags) && msg.tags.includes(options.tagFilter.value)),
      )
    }

    return list
  })

  const providers = computed(() => {
    const set = new Set(timeScopedSessions.value.map((item) => item.provider))
    return Array.from(set)
  })

  const availableTags = computed(() => {
    const set = new Set<string>(options.presetTags)
    for (const session of options.allSessions.value) {
      for (const msg of session.messages || []) {
        for (const tag of Array.isArray(msg.tags) ? msg.tags : []) {
          const value = String(tag || '').trim()
          if (value) set.add(value)
        }
      }
    }
    return Array.from(set)
  })

  const providerSections = computed(() =>
    options.providerCatalog.map((item) => ({
      ...item,
      count:
        item.id === 'all'
          ? timeScopedSessions.value.length
          : timeScopedSessions.value.filter((s) => String(s.provider || '').toLowerCase() === item.id).length,
    })),
  )

  const showRightProviderFilter = computed(() => options.activeProvider.value === 'all')

  const activeAdvancedFilterCount = computed(() => {
    let count = 0
    if (showRightProviderFilter.value && options.providerFilter.value) count += 1
    if (options.timeRangePreset.value !== 'all') count += 1
    if (options.tagFilter.value !== 'all') count += 1
    if (['cursor', 'codex', 'claude-code'].includes(options.activeProvider.value) && options.cursorConversationIdFilter.value.trim()) count += 1
    return count
  })

  return {
    resolveTimeRange,
    normalizeProviderId,
    getProviderDisplayLabel,
    providers,
    timeScopedSessions,
    filteredSessions,
    availableTags,
    providerSections,
    showRightProviderFilter,
    activeAdvancedFilterCount,
  }
}
