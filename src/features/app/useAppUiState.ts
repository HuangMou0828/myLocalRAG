import { ref } from 'vue'
import type { TimeRangePreset } from '@/features/session-filter/useSessionFilterDomain'
import type { ProviderId } from '@/features/navigation/providerCatalog'

export function useAppUiState() {
  const keyword = ref('')
  const useVectorSearch = ref(false)
  const providerFilter = ref('')
  const timeRangePreset = ref<TimeRangePreset>('all')
  const tagFilter = ref('all')
  const cursorConversationIdFilter = ref('')
  const advancedFiltersOpen = ref(false)
  const flowRef = ref<HTMLElement | null>(null)
  const anchoredNodeId = ref('')
  const presetTags = ['工作', '生活', 'AI'] as const

  const selectedSessionId = ref('')
  const bugTraceSubMenu = ref<'trace' | 'inbox'>('trace')
  const feishuMasterSubMenu = ref<'schedule'>('schedule')
  const activeProvider = ref<ProviderId>('all')

  const modelMenuOpen = ref(false)
  const bugMenuOpen = ref(false)
  const feishuMenuOpen = ref(false)
  const componentMenuOpen = ref(false)
  const modelSettingsMenuOpen = ref(false)
  const knowledgeMenuOpen = ref(false)
  const componentSettingsSubMenu = ref<'list' | 'modal' | 'confirm' | 'toast' | 'form' | 'icon'>('list')
  const modelSettingsSubMenu = ref<'management'>('management')
  const sidebarCollapsed = ref(false)
  const sessionListCollapsed = ref(false)
  const sessionOverviewCollapsed = ref(true)
  const knowledgeOverviewCollapsed = ref(true)

  return {
    keyword,
    useVectorSearch,
    providerFilter,
    timeRangePreset,
    tagFilter,
    cursorConversationIdFilter,
    advancedFiltersOpen,
    flowRef,
    anchoredNodeId,
    presetTags,
    selectedSessionId,
    bugTraceSubMenu,
    feishuMasterSubMenu,
    activeProvider,
    modelMenuOpen,
    bugMenuOpen,
    feishuMenuOpen,
    componentMenuOpen,
    modelSettingsMenuOpen,
    knowledgeMenuOpen,
    componentSettingsSubMenu,
    modelSettingsSubMenu,
    sidebarCollapsed,
    sessionListCollapsed,
    sessionOverviewCollapsed,
    knowledgeOverviewCollapsed,
  }
}
