import { computed, ref } from 'vue'
import type { GbrainV2Api, GbrainV2SettingsDto } from '@/services/kbApiServices'

interface UseGbrainV2DomainOptions {
  service?: GbrainV2Api | null
  notify: (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void
}

const STALE_AFTER_MS = 60_000

export function useGbrainV2Domain(options: UseGbrainV2DomainOptions) {
  const gbrainV2Loading = ref(false)
  const gbrainV2Saving = ref(false)
  const gbrainV2Error = ref('')
  const gbrainV2LoadedAt = ref(0)
  const gbrainV2FeedStatus = ref<Awaited<ReturnType<GbrainV2Api['fetchFeedStatus']>> | null>(null)
  const gbrainV2FeedRefreshing = ref(false)
  const gbrainV2Settings = ref<GbrainV2SettingsDto>({
    enabled: false,
    readMode: 'v1',
    feedMode: 'atom-reader-first',
    includeRawFallback: true,
    dualWriteEnabled: true,
    updatedAt: null,
  })

  const gbrainRetrieveQuery = ref('')
  const gbrainRetrieveLoading = ref(false)
  const gbrainRetrieveResult = ref<Awaited<ReturnType<GbrainV2Api['retrieve']>> | null>(null)
  const gbrainPromotionLoading = ref(false)
  const gbrainPromotionError = ref('')
  const gbrainPromotionLoadedAt = ref(0)
  const gbrainPromotionView = ref<Awaited<ReturnType<GbrainV2Api['fetchAtoms']>> | null>(null)

  const hasService = computed(() => Boolean(options.service))

  async function loadGbrainV2FeedStatus(force = false) {
    if (!options.service) return null
    if (!force && gbrainV2FeedStatus.value && gbrainV2LoadedAt.value && Date.now() - gbrainV2LoadedAt.value < STALE_AFTER_MS) {
      return gbrainV2FeedStatus.value
    }
    gbrainV2Loading.value = true
    gbrainV2Error.value = ''
    try {
      const status = await options.service.fetchFeedStatus()
      gbrainV2FeedStatus.value = status
      gbrainV2Settings.value = status.settings
      gbrainV2LoadedAt.value = Date.now()
      return status
    } catch (error) {
      gbrainV2Error.value = String(error || '加载 GBrain V2 状态失败')
      options.notify(gbrainV2Error.value, 'danger')
      return null
    } finally {
      gbrainV2Loading.value = false
    }
  }

  async function saveGbrainV2Settings(patch: Partial<GbrainV2SettingsDto>) {
    if (!options.service) return null
    gbrainV2Saving.value = true
    gbrainV2Error.value = ''
    try {
      const result = await options.service.saveSettings(patch)
      gbrainV2Settings.value = result.settings
      gbrainV2LoadedAt.value = Date.now()
      if (gbrainV2FeedStatus.value) {
        gbrainV2FeedStatus.value = {
          ...gbrainV2FeedStatus.value,
          settings: result.settings,
        }
      }
      options.notify('GBrain V2 设置已更新', 'success')
      return result.settings
    } catch (error) {
      gbrainV2Error.value = String(error || '保存 GBrain V2 设置失败')
      options.notify(gbrainV2Error.value, 'danger')
      return null
    } finally {
      gbrainV2Saving.value = false
    }
  }

  async function refreshGbrainV2Feed(limit = 5000) {
    if (!options.service) return null
    gbrainV2FeedRefreshing.value = true
    gbrainV2Error.value = ''
    try {
      const refreshed = await options.service.refreshFeed({
        limit: Math.max(1, Math.min(5000, Number(limit || 5000))),
        feedMode: gbrainV2Settings.value.feedMode,
        includeRaw: Boolean(gbrainV2Settings.value.includeRawFallback),
        clean: true,
      })
      await loadGbrainV2FeedStatus(true)
      options.notify('GBrain V2 feed 已刷新', 'success')
      return refreshed
    } catch (error) {
      gbrainV2Error.value = String(error || '刷新 GBrain V2 feed 失败')
      options.notify(gbrainV2Error.value, 'danger')
      return null
    } finally {
      gbrainV2FeedRefreshing.value = false
    }
  }

  async function runGbrainV2Retrieve(query?: string, topK = 6) {
    if (!options.service) return null
    const text = String((query ?? gbrainRetrieveQuery.value) || '').trim()
    if (!text) {
      gbrainV2Error.value = '请先输入检索词'
      return null
    }
    gbrainRetrieveLoading.value = true
    gbrainV2Error.value = ''
    gbrainRetrieveQuery.value = text
    try {
      const result = await options.service.retrieve({
        query: text,
        topK: Math.max(1, Math.min(30, Number(topK || 6))),
        readMode: gbrainV2Settings.value.readMode,
      })
      gbrainRetrieveResult.value = result
      return result
    } catch (error) {
      gbrainV2Error.value = String(error || 'GBrain V2 检索失败')
      options.notify(gbrainV2Error.value, 'danger')
      return null
    } finally {
      gbrainRetrieveLoading.value = false
    }
  }

  async function loadGbrainV2PromotionView(force = false) {
    if (!options.service) return null
    if (!force && gbrainPromotionView.value && gbrainPromotionLoadedAt.value && Date.now() - gbrainPromotionLoadedAt.value < STALE_AFTER_MS) {
      return gbrainPromotionView.value
    }
    gbrainPromotionLoading.value = true
    gbrainPromotionError.value = ''
    try {
      const result = await options.service.fetchAtoms({
        limit: 800,
        kind: 'all',
        qualityTier: 'all',
        status: 'visible',
        includeStats: true,
      })
      gbrainPromotionView.value = result
      gbrainPromotionLoadedAt.value = Date.now()
      return result
    } catch (error) {
      gbrainPromotionError.value = String(error || '加载 GBrain V2 Promotion 视图失败')
      options.notify(gbrainPromotionError.value, 'danger')
      return null
    } finally {
      gbrainPromotionLoading.value = false
    }
  }

  return {
    hasGbrainV2Service: hasService,
    gbrainV2Loading,
    gbrainV2Saving,
    gbrainV2Error,
    gbrainV2LoadedAt,
    gbrainV2FeedStatus,
    gbrainV2FeedRefreshing,
    gbrainV2Settings,
    gbrainRetrieveQuery,
    gbrainRetrieveLoading,
    gbrainRetrieveResult,
    gbrainPromotionLoading,
    gbrainPromotionError,
    gbrainPromotionLoadedAt,
    gbrainPromotionView,
    loadGbrainV2FeedStatus,
    saveGbrainV2Settings,
    refreshGbrainV2Feed,
    runGbrainV2Retrieve,
    loadGbrainV2PromotionView,
  }
}
