import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import type { WikiVaultApi } from '@/services/kbApiServices'

export type WikiVaultSyncMode = 'publish-only' | 'publish-with-summary'

interface WikiVaultSyncStats {
  provider: string
  generatedAt: string | null
  syncMode: WikiVaultSyncMode
  publishedCount: number
  conceptCount: number
  llmConceptCount: number
  fallbackConceptCount: number
  currentSessions: number
  currentConcepts: number
  llmEligibleConcepts: number
}

interface WikiVaultSyncPreview {
  provider: string
  syncMode: WikiVaultSyncMode
  totalSessions: number
  totalConcepts: number
  llmEligibleConcepts: number
  targetConcepts: number
  estimatedSteps: number
  estimatedModelCalls: number
  reusableLlmConcepts: number
  skippedConcepts: number
}

interface WikiVaultSyncJob {
  id: string
  status: string
  provider: string
  syncMode: WikiVaultSyncMode
  totalSessions: number
  totalConcepts: number
  llmEligibleConcepts: number
  estimatedModelCalls: number
  totalSteps: number
  processedSteps: number
  publishedCount: number
  llmConceptCount: number
  fallbackConceptCount: number
  skippedConceptCount: number
  reusedLlmConceptCount: number
  reusedFallbackConceptCount: number
  progress: number
  statusText?: string
  error?: string | null
  createdAt: string
  startedAt?: string
  finishedAt?: string
  lastRun?: Omit<WikiVaultSyncStats, 'currentSessions' | 'currentConcepts' | 'llmEligibleConcepts'> | null
}

interface UseWikiVaultSyncDomainOptions {
  service: WikiVaultApi
  activeProvider: Ref<string>
  availableProviders: Ref<string[]>
  getProviderDisplayLabel: (provider: string) => string
  notify: (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void
}

function normalizeSyncMode(value: string): WikiVaultSyncMode {
  return value === 'publish-with-summary' ? 'publish-with-summary' : 'publish-only'
}

function normalizeProviderScope(activeProvider: string, availableProviders: string[]) {
  const provider = String(activeProvider || '').trim().toLowerCase()
  return Array.isArray(availableProviders) && availableProviders.includes(provider) ? provider : 'all'
}

const EMPTY_STATS: WikiVaultSyncStats = {
  provider: 'all',
  generatedAt: null,
  syncMode: 'publish-only',
  publishedCount: 0,
  conceptCount: 0,
  llmConceptCount: 0,
  fallbackConceptCount: 0,
  currentSessions: 0,
  currentConcepts: 0,
  llmEligibleConcepts: 0,
}

export function useWikiVaultSyncDomain(options: UseWikiVaultSyncDomainOptions) {
  const wikiVaultSyncModalOpen = ref(false)
  const wikiVaultSyncMode = ref<WikiVaultSyncMode>('publish-only')
  const wikiVaultSyncStats = ref<WikiVaultSyncStats>({ ...EMPTY_STATS })
  const wikiVaultSyncStatsLoading = ref(false)
  const wikiVaultSyncPreview = ref<WikiVaultSyncPreview | null>(null)
  const wikiVaultSyncPreviewLoading = ref(false)
  const wikiVaultSyncJob = ref<WikiVaultSyncJob | null>(null)
  const syncingWikiVault = ref(false)

  let wikiVaultSyncPollTimer: ReturnType<typeof setTimeout> | null = null

  const wikiVaultProviderScope = computed(() =>
    normalizeProviderScope(options.activeProvider.value, options.availableProviders.value),
  )

  const wikiVaultProviderLabel = computed(() => {
    const provider = wikiVaultProviderScope.value
    return provider === 'all' ? '全部来源' : options.getProviderDisplayLabel(provider)
  })

  const wikiVaultCanStart = computed(() =>
    !syncingWikiVault.value
    && !wikiVaultSyncPreviewLoading.value
    && Number(wikiVaultSyncPreview.value?.totalSessions || 0) > 0,
  )

  function stopWikiVaultSyncPolling() {
    if (wikiVaultSyncPollTimer) clearTimeout(wikiVaultSyncPollTimer)
    wikiVaultSyncPollTimer = null
  }

  async function loadWikiVaultSyncStats() {
    wikiVaultSyncStatsLoading.value = true
    try {
      const provider = wikiVaultProviderScope.value
      const stats = await options.service.fetchStats(provider)
      wikiVaultSyncStats.value = {
        ...EMPTY_STATS,
        ...stats,
        provider: String(stats?.provider || provider || 'all'),
        syncMode: normalizeSyncMode(String(stats?.syncMode || wikiVaultSyncMode.value)),
      }
    } catch (error) {
      options.notify(`读取 Obsidian 同步统计失败：${String(error instanceof Error ? error.message : error || '未知错误')}`, 'danger')
    } finally {
      wikiVaultSyncStatsLoading.value = false
    }
  }

  async function loadWikiVaultSyncPreview() {
    wikiVaultSyncPreviewLoading.value = true
    try {
      const provider = wikiVaultProviderScope.value
      const preview = await options.service.preview({
        provider,
        syncMode: wikiVaultSyncMode.value,
      })
      wikiVaultSyncPreview.value = {
        ...preview,
        provider: String(preview?.provider || provider || 'all'),
        syncMode: normalizeSyncMode(String(preview?.syncMode || wikiVaultSyncMode.value)),
      }
    } catch (error) {
      wikiVaultSyncPreview.value = null
      options.notify(`读取 Obsidian 同步预估失败：${String(error instanceof Error ? error.message : error || '未知错误')}`, 'danger')
    } finally {
      wikiVaultSyncPreviewLoading.value = false
    }
  }

  async function pollWikiVaultSyncJob(jobId: string) {
    stopWikiVaultSyncPolling()
    const result = await options.service.fetchSyncJob(jobId)
    wikiVaultSyncJob.value = result?.job || null
    const job = wikiVaultSyncJob.value

    if (!job) {
      syncingWikiVault.value = false
      return
    }

    const running = job.status === 'queued' || job.status === 'running'
    syncingWikiVault.value = running

    if (running) {
      wikiVaultSyncPollTimer = setTimeout(() => {
        void pollWikiVaultSyncJob(jobId)
      }, 1200)
      return
    }

    stopWikiVaultSyncPolling()
    syncingWikiVault.value = false
    await Promise.all([loadWikiVaultSyncStats(), loadWikiVaultSyncPreview()])

    if (job.status === 'completed') {
      const modeLabel = job.syncMode === 'publish-with-summary' ? '深度汇总' : '快速发布'
      options.notify(
        `Obsidian 同步完成：${modeLabel}，发布 ${Number(job.publishedCount || 0)} 条 source，LLM 汇总 ${Number(job.llmConceptCount || 0)} 个 concept`,
        'success',
      )
      return
    }

    options.notify(`Obsidian 同步失败：${String(job.error || job.statusText || '未知错误')}`, 'danger')
  }

  async function startWikiVaultSync() {
    if (!wikiVaultCanStart.value) return
    syncingWikiVault.value = true
    try {
      const provider = wikiVaultProviderScope.value
      const result = await options.service.startSyncJob({
        provider,
        syncMode: wikiVaultSyncMode.value,
      })
      wikiVaultSyncJob.value = result?.job || null
      if (result?.preview) {
        wikiVaultSyncPreview.value = {
          ...result.preview,
          provider: String(result.preview.provider || provider || 'all'),
          syncMode: normalizeSyncMode(String(result.preview.syncMode || wikiVaultSyncMode.value)),
        }
      }
      const jobId = String(result?.job?.id || '')
      if (!jobId) {
        syncingWikiVault.value = false
        options.notify('未拿到有效的同步任务 ID', 'danger')
        return
      }
      await pollWikiVaultSyncJob(jobId)
    } catch (error) {
      syncingWikiVault.value = false
      options.notify(`启动 Obsidian 同步失败：${String(error instanceof Error ? error.message : error || '未知错误')}`, 'danger')
    }
  }

  async function openWikiVaultSyncModal() {
    wikiVaultSyncModalOpen.value = true
    await loadWikiVaultSyncStats()
    wikiVaultSyncMode.value = normalizeSyncMode(wikiVaultSyncStats.value.syncMode || 'publish-only')
    await loadWikiVaultSyncPreview()
  }

  function closeWikiVaultSyncModal(force = false) {
    if (syncingWikiVault.value && !force) return
    wikiVaultSyncModalOpen.value = false
  }

  onBeforeUnmount(() => {
    stopWikiVaultSyncPolling()
  })

  return {
    wikiVaultSyncModalOpen,
    wikiVaultSyncMode,
    wikiVaultSyncStats,
    wikiVaultSyncStatsLoading,
    wikiVaultSyncPreview,
    wikiVaultSyncPreviewLoading,
    wikiVaultSyncJob,
    syncingWikiVault,
    wikiVaultProviderScope,
    wikiVaultProviderLabel,
    wikiVaultCanStart,
    openWikiVaultSyncModal,
    closeWikiVaultSyncModal,
    loadWikiVaultSyncStats,
    loadWikiVaultSyncPreview,
    startWikiVaultSync,
  }
}
