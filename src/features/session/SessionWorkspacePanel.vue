<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import MarkdownContent from '@/components/MarkdownContent.vue'
import {
  ChevronDown,
  ChevronUp,
  FolderOpen,
  MessageSquareOff,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Sparkles,
  Tags,
  Target,
  Terminal,
  Trash2,
  User,
  Brain,
} from 'lucide-vue-next'

const props = defineProps<{ ctx: Record<string, any> }>()

function writeMaybeRef(source: any, value: unknown) {
  if (!source || typeof source !== 'object' || !('value' in source)) return
  source.value = value
}

function resolveMaybeFunction<T extends (...args: any[]) => any>(source: any): T | null {
  return typeof source === 'function' ? (source as T) : null
}

function readMaybeRef<T>(source: any): T | undefined {
  if (source && typeof source === 'object' && 'value' in source) return source.value as T
  return source as T
}

const {
  sessionListCollapsed,
  sessionOverviewCollapsed,
  keyword,
  useVectorSearch,
  loadSessions,
  activeAdvancedFilterCount,
  advancedFiltersOpen,
  activeProvider,
  cursorConversationIdFilter,
  showRightProviderFilter,
  providerFilter,
  providers,
  timeRangePreset,
  tagFilter,
  availableTags,
  hasKeyword,
  retrieving,
  retrieveMeta,
  filteredSessions,
  loading,
  selectedSession,
  selectedSessionId,
  getSessionDisplayTitle,
  getSessionRefs,
  normalizeProviderId,
  getProviderDisplayLabel,
  formatTime,
  getSessionMessageTags,
  getTurnCount,
  openImportModal,
  userAnchorIds,
  jumpToUserAnchor,
  jumpToTurnIndex,
  openDeleteConfirm,
  updatingSessionReviewId,
  updateSessionReview,
  deletingSessionId,
  flowRef,
  selectedSessionFlow,
  anchoredNodeId,
  setFlowNodeRef,
  openPromptScoreModal,
  openTagModal,
  getAssistantDisplayChunks,
} = props.ctx

const matchedEvidenceOpen = ref(false)
const matchedEvidenceSession = ref<any | null>(null)
const reviewStatusModalOpen = ref(false)
const pendingReviewStatus = ref<'pending' | 'kept' | 'downgraded' | 'hidden'>('pending')

function getMatchedSnippets(session: any): string[] {
  return Array.isArray(session?.matchedSnippets) ? session.matchedSnippets.filter(Boolean).slice(0, 6) : []
}

function getMatchedTurns(session: any): number[] {
  return Array.isArray(session?.matchedTurnIndexes) ? session.matchedTurnIndexes.filter((value: unknown) => Number.isInteger(value)).slice(0, 4) : []
}

function getMatchedFiles(session: any): string[] {
  const chunks = Array.isArray(session?.matchedChunks) ? session.matchedChunks : []
  const files = chunks.flatMap((chunk: any) => (Array.isArray(chunk?.filePaths) ? chunk.filePaths : [])) as unknown[]
  const normalizedFiles = files
    .map((item) => String(item || '').trim())
    .filter((item: string) => Boolean(item))
  return [...new Set<string>(normalizedFiles)].slice(0, 8)
}

function getMatchedChunks(session: any): any[] {
  return Array.isArray(session?.matchedChunks) ? session.matchedChunks.filter(Boolean).slice(0, 6) : []
}

function getMatchedChunkCount(session: any): number {
  return Number(session?.matchedChunkCount || getMatchedChunks(session).length || 0)
}

function getVisibleSessionRefs(session: any): string[] {
  return getSessionRefs(session).slice(0, 1)
}

function getHiddenSessionRefCount(session: any): number {
  return Math.max(0, getSessionRefs(session).length - getVisibleSessionRefs(session).length)
}

function getVisibleSessionTags(session: any): string[] {
  return getSessionMessageTags(session).slice(0, 3)
}

function getHiddenSessionTagCount(session: any): number {
  return Math.max(0, getSessionMessageTags(session).length - getVisibleSessionTags(session).length)
}

function hasMatchedEvidence(session: any): boolean {
  return getMatchedChunkCount(session) > 0 || getMatchedTurns(session).length > 0
}

function getMatchedTurnLabel(turnIndex: number): string {
  return `第 ${Number(turnIndex) + 1} 轮`
}

function getMatchMode(target: any): string {
  const vector = Number(target?.vector_similarity ?? target?.vectorSimilarity ?? 0)
  const lexical = Number(target?.lexical_score ?? target?.lexicalScore ?? 0)
  if (vector > 0.35 && lexical > 0) return '混合命中'
  if (vector > 0.35) return '语义命中'
  if (lexical > 0) return '关键词命中'
  return '相关命中'
}

function getRetrieveFallbackReason(meta: any): string {
  const error = String(meta?.error || '').trim()
  if (!meta?.fallback) return error
  if (error) return error
  if (String(meta?.source || '').trim().toLowerCase() === 'local') return '远端向量不可用，已降级到本地向量'
  return '远端向量不可用，已触发降级'
}

function getSessionReviewStatus(session: any): 'pending' | 'kept' | 'downgraded' | 'hidden' {
  const normalized = String(session?.meta?.review?.status || '').trim().toLowerCase()
  if (normalized === 'kept' || normalized === 'downgraded' || normalized === 'hidden') return normalized
  return 'pending'
}

function getSessionReviewLabel(session: any): string {
  const status = getSessionReviewStatus(session)
  if (status === 'kept') return '已保留'
  if (status === 'downgraded') return '已降权'
  if (status === 'hidden') return '已隐藏'
  return '待审核'
}

function getSessionSyncStatus(session: any): 'active' | 'missing' | 'orphaned' {
  const normalized = String(session?.meta?.sync?.syncStatus || '').trim().toLowerCase()
  if (normalized === 'missing' || normalized === 'orphaned') return normalized
  return 'active'
}

function getSessionSyncLabel(session: any): string {
  const status = getSessionSyncStatus(session)
  if (status === 'missing') return '来源缺失'
  if (status === 'orphaned') return '来源失联'
  return '同步正常'
}

async function onUpdateSelectedSessionReview(status: 'pending' | 'kept' | 'downgraded' | 'hidden') {
  const session = readMaybeRef<any>(selectedSession)
  const fn = resolveMaybeFunction<(payload: { id: string; status: 'pending' | 'kept' | 'downgraded' | 'hidden' }) => Promise<void>>(updateSessionReview)
  if (!session?.id || !fn) return
  await fn({ id: String(session.id), status })
}

function openReviewStatusModal() {
  const session = readMaybeRef<any>(selectedSession)
  if (!session?.id) return
  pendingReviewStatus.value = getSessionReviewStatus(session)
  reviewStatusModalOpen.value = true
}

function closeReviewStatusModal() {
  reviewStatusModalOpen.value = false
}

async function confirmReviewStatusUpdate() {
  const session = readMaybeRef<any>(selectedSession)
  if (!session?.id) return
  await onUpdateSelectedSessionReview(pendingReviewStatus.value)
  closeReviewStatusModal()
}

function getPrimaryMatchedSnippet(session: any): string {
  return getMatchedSnippets(session)[0] || ''
}

function getChunkAskText(chunk: any): string {
  return String(chunk?.userIntent || chunk?.summary || '').trim()
}

function getChunkAnswerSummary(chunk: any): string {
  return String(chunk?.assistantSummary || '').trim()
}

function normalizeEvidenceText(text: unknown): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function isSameEvidence(a: unknown, b: unknown): boolean {
  const left = normalizeEvidenceText(a)
  const right = normalizeEvidenceText(b)
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

function getChunkSnippetText(chunk: any): string {
  return String(chunk?.snippet || '').trim()
}

function getVisibleAskText(chunk: any): string {
  const ask = getChunkAskText(chunk)
  const answer = getChunkAnswerSummary(chunk)
  const snippet = getChunkSnippetText(chunk)
  if (!ask) return ''
  if (isSameEvidence(ask, answer) || isSameEvidence(ask, snippet)) return ''
  return ask
}

function getVisibleAnswerSummary(chunk: any): string {
  const answer = getChunkAnswerSummary(chunk)
  const ask = getChunkAskText(chunk)
  const snippet = getChunkSnippetText(chunk)
  if (!answer) return ''
  if (isSameEvidence(answer, ask) || isSameEvidence(answer, snippet)) return ''
  return answer
}

function getVisibleErrorKeywords(chunk: any): string[] {
  const list = Array.isArray(chunk?.errorKeywords) ? chunk.errorKeywords : []
  const merged = [
    getChunkSnippetText(chunk),
    getChunkAskText(chunk),
    getChunkAnswerSummary(chunk),
  ].filter(Boolean).join(' ')

  return list
    .map((item: unknown) => String(item || '').trim())
    .filter((item: string) => Boolean(item))
    .filter((item: string, index: number, arr: string[]) => arr.indexOf(item) === index)
    .filter((item: string) => !isSameEvidence(item, merged))
    .slice(0, 3)
}

function openMatchedEvidence(session: any) {
  matchedEvidenceSession.value = session || null
  matchedEvidenceOpen.value = true
}

function closeMatchedEvidence() {
  matchedEvidenceOpen.value = false
}

async function focusMatchedTurn(session: any, turnIndex?: number) {
  closeMatchedEvidence()
  writeMaybeRef(selectedSessionId, String(session?.id || ''))
  await nextTick()
  if (Number.isInteger(turnIndex)) jumpToTurnIndex(Number(turnIndex))
}

async function onResetSessionFilters() {
  writeMaybeRef(keyword, '')
  writeMaybeRef(useVectorSearch, false)
  writeMaybeRef(providerFilter, '')
  writeMaybeRef(timeRangePreset, 'all')
  writeMaybeRef(tagFilter, 'all')
  writeMaybeRef(cursorConversationIdFilter, '')
  writeMaybeRef(advancedFiltersOpen, false)
  const action = resolveMaybeFunction<() => Promise<unknown> | void>(loadSessions)
  await action?.()
}

async function onSelectSession(session: any) {
  writeMaybeRef(selectedSessionId, String(session?.id || ''))
  await nextTick()
  const firstTurn = getMatchedTurns(session)[0]
  if (Number.isInteger(firstTurn)) jumpToTurnIndex(firstTurn)
}

async function onToggleVectorSearch() {
  const next = !Boolean(useVectorSearch?.value)
  writeMaybeRef(useVectorSearch, next)
  if (!String(keyword?.value || '').trim()) return
  const action = resolveMaybeFunction<() => Promise<unknown> | void>(loadSessions)
  await action?.()
}

watch(
  () => readMaybeRef<any>(selectedSession)?.id || '',
  async () => {
    const current = readMaybeRef<any>(selectedSession)
    const firstTurn = getMatchedTurns(current)[0]
    if (!Number.isInteger(firstTurn)) return
    await nextTick()
    jumpToTurnIndex(firstTurn)
  },
)
</script>

<template>
      <Dialog :open="reviewStatusModalOpen" @update:open="(open) => { if (!open) closeReviewStatusModal() }">
        <DialogContent class="component-confirm-dialog component-confirm-dialog--compact component-confirm-dialog--tone-success session-review-dialog" :show-close="false">
          <div class="component-confirm-head">
            <h4>调整审核状态</h4>
            <span class="component-confirm-tone" data-tone="success">review</span>
          </div>
          <p class="component-confirm-desc">
            为当前会话选择新的审核状态，确认后立即生效。
          </p>
          <p class="confirm-title" v-if="selectedSession">「{{ getSessionDisplayTitle(selectedSession) }}」</p>

          <div class="session-review-option-list">
            <button
              type="button"
              class="app-btn-ghost session-review-option"
              :class="{ active: pendingReviewStatus === 'pending' }"
              @click="pendingReviewStatus = 'pending'"
            >
              <span class="session-review-chip" data-status="pending">待审核</span>
              <small>暂时保留，后续再筛</small>
            </button>
            <button
              type="button"
              class="app-btn-ghost session-review-option"
              :class="{ active: pendingReviewStatus === 'kept' }"
              @click="pendingReviewStatus = 'kept'"
            >
              <span class="session-review-chip" data-status="kept">已保留</span>
              <small>作为优质会话保留</small>
            </button>
            <button
              type="button"
              class="app-btn-ghost session-review-option"
              :class="{ active: pendingReviewStatus === 'downgraded' }"
              @click="pendingReviewStatus = 'downgraded'"
            >
              <span class="session-review-chip" data-status="downgraded">已降权</span>
              <small>保留记录，但降低优先级</small>
            </button>
            <button
              type="button"
              class="app-btn-ghost session-review-option"
              :class="{ active: pendingReviewStatus === 'hidden' }"
              @click="pendingReviewStatus = 'hidden'"
            >
              <span class="session-review-chip" data-status="hidden">已隐藏</span>
              <small>从默认列表和检索中移除</small>
            </button>
          </div>

          <footer class="component-confirm-actions">
            <button type="button" class="app-btn-ghost" @click="closeReviewStatusModal" :disabled="!!updatingSessionReviewId">取消</button>
            <button class="app-btn" type="button" @click="confirmReviewStatusUpdate" :disabled="!!updatingSessionReviewId">
              {{ updatingSessionReviewId ? '保存中...' : '确认修改' }}
            </button>
          </footer>
        </DialogContent>
      </Dialog>

      <Dialog :open="matchedEvidenceOpen" @update:open="(open) => { if (!open) closeMatchedEvidence() }">
        <DialogScrollContent
          class="component-modal-dialog component-modal-dialog--lg component-modal-dialog--tone-info matched-evidence-dialog"
          :show-close="false"
        >
          <DialogHeader class="component-modal-dialog-header matched-evidence-dialog-header">
            <div class="component-modal-dialog-title-row">
              <div class="matched-evidence-dialog-title-wrap">
                <DialogTitle class="matched-evidence-dialog-title">命中详情</DialogTitle>
                <DialogDescription class="matched-evidence-dialog-desc">
                  {{ matchedEvidenceSession ? `${getSessionDisplayTitle(matchedEvidenceSession)} · ${getMatchMode(matchedEvidenceSession)} · 命中 ${getMatchedChunkCount(matchedEvidenceSession)} 处` : '查看本次检索命中的依据与定位点。' }}
                </DialogDescription>
              </div>
              <DialogClose as-child>
                <button
                  type="button"
                  class="app-btn-ghost modal-close-btn"
                  aria-label="关闭命中详情"
                >×</button>
              </DialogClose>
            </div>
          </DialogHeader>

          <div v-if="matchedEvidenceSession" class="component-modal-dialog-body matched-evidence-dialog-body">
            <div class="matched-evidence-summary">
              <span class="matched-evidence-summary-chip">{{ getMatchMode(matchedEvidenceSession) }}</span>
              <span class="matched-evidence-summary-chip">命中 {{ getMatchedChunkCount(matchedEvidenceSession) }} 处</span>
              <span class="matched-evidence-summary-chip" v-for="turnIndex in getMatchedTurns(matchedEvidenceSession)" :key="`modal-turn-${turnIndex}`">
                {{ getMatchedTurnLabel(turnIndex) }}
              </span>
            </div>

            <details class="matched-evidence-files" v-if="getMatchedFiles(matchedEvidenceSession).length">
              <summary class="matched-evidence-files-summary">
                关联文件
                <span>{{ getMatchedFiles(matchedEvidenceSession).length }}</span>
              </summary>
              <div class="matched-evidence-file-list">
                <span class="session-ref" v-for="filePath in getMatchedFiles(matchedEvidenceSession)" :key="`modal-file-${filePath}`">{{ filePath }}</span>
              </div>
            </details>

            <article
              v-for="chunk in getMatchedChunks(matchedEvidenceSession)"
              :key="chunk.chunkId"
              class="matched-evidence-item"
            >
              <div class="matched-evidence-item-head">
                <div class="matched-evidence-item-tags">
                  <span class="matched-evidence-item-mode">{{ getMatchMode(chunk) }}</span>
                  <span class="matched-evidence-item-turn" v-if="Number.isInteger(chunk.turnIndex)">{{ getMatchedTurnLabel(chunk.turnIndex) }}</span>
                </div>
                <button
                  type="button"
                  class="app-btn-ghost matched-evidence-locate-btn"
                  @click="focusMatchedTurn(matchedEvidenceSession, chunk.turnIndex)"
                >
                  定位到对话
                </button>
              </div>

              <div class="matched-evidence-summary-card" v-if="getVisibleAskText(chunk) || getVisibleAnswerSummary(chunk)">
                <div class="matched-evidence-summary-block" v-if="getVisibleAskText(chunk)">
                  <small>提问</small>
                  <p>{{ getVisibleAskText(chunk) }}</p>
                </div>
                <div class="matched-evidence-summary-block" v-if="getVisibleAnswerSummary(chunk)">
                  <small>回答摘要</small>
                  <p>{{ getVisibleAnswerSummary(chunk) }}</p>
                </div>
              </div>

              <p class="matched-evidence-snippet">{{ chunk.snippet || getChunkAnswerSummary(chunk) || getChunkAskText(chunk) || '暂无片段摘要' }}</p>

              <details class="matched-evidence-hints" v-if="getVisibleErrorKeywords(chunk).length">
                <summary class="matched-evidence-hints-summary">错误线索</summary>
                <div class="matched-evidence-meta">
                  <span class="msg-tag-chip" v-for="keyword in getVisibleErrorKeywords(chunk)" :key="`${chunk.chunkId}-kw-${keyword}`">{{ keyword }}</span>
                </div>
              </details>
            </article>
          </div>
        </DialogScrollContent>
      </Dialog>

      <section class="panel-soft session-search-panel">
        <div class="session-overview-toggle-row">
          <button
            type="button"
            class="app-btn-ghost session-overview-toggle-btn"
            @click="sessionOverviewCollapsed = !sessionOverviewCollapsed"
          >
            {{ sessionOverviewCollapsed ? '展开概览' : '收起概览' }}
          </button>
        </div>

        <div v-show="!sessionOverviewCollapsed" class="session-search-head">
          <div class="session-search-copy">
            <small>Session Workspace</small>
            <h2>会话工作区</h2>
            <p>按来源、时间、标签和命中证据快速筛出历史会话，再进入右侧查看完整对话脉络。</p>
          </div>

          <div class="session-search-stats">
            <div class="session-search-stat">
              <span>当前来源</span>
              <strong>{{ activeProvider ? getProviderDisplayLabel(activeProvider) : '全部来源' }}</strong>
            </div>
            <div class="session-search-stat">
              <span>结果数</span>
              <strong>{{ filteredSessions.length }}</strong>
            </div>
          </div>
        </div>

        <div class="session-filter-bar">
          <div class="session-search-primary-row">
            <button
              type="button"
              class="app-btn-ghost collapse-btn session-filter-icon-btn"
              :title="sessionListCollapsed ? '展开会话列表' : '收起会话列表'"
              :aria-label="sessionListCollapsed ? '展开会话列表' : '收起会话列表'"
              @click="sessionListCollapsed = !sessionListCollapsed"
            >
              <PanelLeftOpen v-if="sessionListCollapsed" :size="20" />
              <PanelLeftClose v-else :size="20" />
            </button>

            <input class="app-input session-filter-search"
              v-model="keyword"
              type="text"
              placeholder="搜索标题、消息内容、错误线索..."
              @keyup.enter="loadSessions"
            />

            <button
              type="button"
              class="app-btn session-search-submit-btn"
              :disabled="loading || retrieving"
              @click="loadSessions"
            >
              <RefreshCw v-if="loading || retrieving" :size="16" class="animate-spin" />
              <template v-else>检索会话</template>
            </button>
          </div>

          <div class="session-search-secondary-row">
            <div class="session-search-toolbar-meta-row">
              <div class="session-search-toolbar-row">
              <button
                type="button"
                class="app-btn-ghost session-filter-toolbar-btn"
                :class="{ active: useVectorSearch }"
                @click="onToggleVectorSearch"
              >
                {{ useVectorSearch ? '语义检索' : '关键词检索' }}
              </button>

              <button
                type="button"
                class="app-btn-ghost advanced-toggle-btn session-filter-toolbar-btn"
                :class="{ active: advancedFiltersOpen || activeAdvancedFilterCount > 0 }"
                @click="advancedFiltersOpen = !advancedFiltersOpen"
              >
                高级筛选
                <span class="advanced-badge" v-if="activeAdvancedFilterCount > 0">{{ activeAdvancedFilterCount }}</span>
              </button>

              <button
                type="button"
                class="app-btn-ghost session-filter-toolbar-btn session-filter-reset-btn"
                @click="onResetSessionFilters"
              >
                重置
              </button>
            </div>

              <div class="retrieve-meta-row session-retrieve-meta-inline" v-if="hasKeyword">
                <span class="retrieve-chip" v-if="!useVectorSearch">关键词索引</span>
                <span class="retrieve-chip" v-if="retrieving">语义检索中...</span>
                <template v-else-if="retrieveMeta">
                  <span class="retrieve-chip">向量覆盖 {{ Math.round(Number(retrieveMeta.coverage || 0) * 100) }}%</span>
                  <span class="retrieve-chip">懒生成 {{ Number(retrieveMeta.regenerated || 0) }}</span>
                  <span class="retrieve-chip">来源 {{ retrieveMeta.source || '-' }}</span>
                  <span class="retrieve-chip">模型 {{ retrieveMeta.model || '-' }}</span>
                  <span class="retrieve-chip warn-chip" v-if="retrieveMeta.fallback" :title="getRetrieveFallbackReason(retrieveMeta)">
                    已降级：{{ getRetrieveFallbackReason(retrieveMeta) }}
                  </span>
                  <span class="retrieve-meta-text" v-else-if="retrieveMeta.error" :title="retrieveMeta.error">
                    提示：{{ retrieveMeta.error }}
                  </span>
                </template>
              </div>
            </div>
          </div>

          <div class="advanced-filters" v-show="advancedFiltersOpen">
            <input class="app-input"
              v-if="activeProvider === 'cursor' || activeProvider === 'codex' || activeProvider === 'claude-code'"
              v-model="cursorConversationIdFilter"
              type="text"
              placeholder="按会话 ID 搜索（支持部分匹配）"
              @keyup.enter="loadSessions"
            />

            <select class="app-select" v-if="showRightProviderFilter" v-model="providerFilter">
              <option value="">全部 AI</option>
              <option v-for="provider in providers" :key="provider" :value="provider">{{ provider }}</option>
            </select>

            <select class="app-select" v-model="timeRangePreset" @change="loadSessions">
              <option value="all">全部时间</option>
              <option value="today">今天</option>
              <option value="7d">近 7 天</option>
              <option value="30d">近 30 天</option>
              <option value="90d">近 90 天</option>
            </select>

            <select class="app-select" v-model="tagFilter">
              <option value="all">全部标签</option>
              <option v-for="tag in availableTags" :key="tag" :value="tag">{{ tag }}</option>
            </select>
          </div>
        </div>
      </section>

      <div class="session-grid" :class="{ 'list-collapsed': sessionListCollapsed }">
        <section class="panel-soft list-panel" v-if="!sessionListCollapsed">
          <header class="list-panel-header">
            <div class="panel-heading">
              <small>Recent Sessions</small>
              <h3>会话列表</h3>
              <p>优先展示最近更新内容，并在命中结果里暴露证据与状态。</p>
            </div>
            <span class="panel-count">{{ filteredSessions.length }} 条</span>
          </header>

          <TransitionGroup name="list" tag="div" class="session-list" v-if="!loading && filteredSessions.length">
            <button
              v-for="item in filteredSessions"
              :key="item.id"
              class="session-card"
              :class="{ active: selectedSession?.id === item.id }"
              @click="onSelectSession(item)"
            >
              <div class="session-card-head">
                <h4 :title="getSessionDisplayTitle(item)">{{ getSessionDisplayTitle(item) }}</h4>
                <button
                  v-if="hasMatchedEvidence(item)"
                  type="button"
                  class="app-btn-ghost session-hit-trigger"
                  :title="`查看命中详情（${getMatchedChunkCount(item)} 处）`"
                  @click.stop="openMatchedEvidence(item)"
                >
                  <Brain :size="14" />
                  <span>{{ getMatchedChunkCount(item) }}</span>
                </button>
              </div>
              <p class="session-meta-row">
                <span class="provider-chip" :data-provider="normalizeProviderId(item.provider)">
                  <span class="provider-label">{{ getProviderDisplayLabel(item.provider) }}</span>
                </span>
                <span class="session-review-chip session-review-chip--inline" :data-status="getSessionReviewStatus(item)">
                  {{ getSessionReviewLabel(item) }}
                </span>
                <span class="session-meta-time-group">
                  <span class="meta-time-label">更新于</span>
                  <span class="meta-time">{{ formatTime(item.updatedAt) }}</span>
                </span>
              </p>
              <p class="session-hit-summary" v-if="hasMatchedEvidence(item)">
                证据 · {{ getMatchMode(item) }} · {{ getPrimaryMatchedSnippet(item) || `命中 ${getMatchedChunkCount(item)} 处相关内容` }}
              </p>
              <div class="session-ref-list" v-if="getVisibleSessionRefs(item).length">
                <span class="session-ref" v-for="refPath in getVisibleSessionRefs(item)" :key="`${item.id}-${refPath}`">{{ refPath }}</span>
                <span class="session-ref session-ref-count" v-if="getHiddenSessionRefCount(item) > 0">
                  +{{ getHiddenSessionRefCount(item) }}
                </span>
              </div>
              <div class="session-tag-list" v-if="getVisibleSessionTags(item).length">
                <span class="msg-tag-chip" v-for="tag in getVisibleSessionTags(item)" :key="`${item.id}-tag-${tag}`">{{ tag }}</span>
                <span class="msg-tag-chip msg-tag-chip-muted" v-if="getHiddenSessionTagCount(item) > 0">
                  +{{ getHiddenSessionTagCount(item) }}
                </span>
              </div>
              <small class="session-card-footnote">{{ item.messages.length }} 条消息 · {{ getTurnCount(item.messages) }} 轮对话</small>
            </button>
          </TransitionGroup>

          <div v-else-if="loading" class="session-list loading-list">
            <div v-for="i in 5" :key="`skel-${i}`" class="skeleton skeleton-card">
              <div class="skeleton skeleton-text short"></div>
              <div class="skeleton skeleton-text medium"></div>
            </div>
          </div>

          <div v-else class="empty-dashboard-state">
            <div class="empty-state-icon">
              <MessageSquareOff :size="38" />
            </div>
            <h3 class="empty-state-title">还没有会话内存</h3>
            <p class="empty-state-desc">
              系统当前在选定的范围内没有找到匹配的记录。你可以尝试更换筛选条件，或者导入新的数据。
            </p>
            <div class="empty-state-actions">
              <button type="button" class="app-btn empty-cta-btn" @click="openImportModal">
                <FolderOpen :size="18" /> 导入文件夹
              </button>
            </div>
          </div>
        </section>

        <Transition name="fade" mode="out-in">
          <section class="panel-soft detail" v-if="selectedSession" :key="selectedSession.id">
            <header class="detail-header">
              <div class="detail-header-copy">
                <div class="detail-title-block">
                  <small>Conversation Detail</small>
                  <h3>{{ getSessionDisplayTitle(selectedSession) }}</h3>
                </div>
                <p class="detail-summary">{{ selectedSession.messages.length }} 条消息 · {{ getTurnCount(selectedSession.messages) }} 轮对话</p>
                <p class="session-meta-row">
                  <span class="provider-chip" :data-provider="normalizeProviderId(selectedSession.provider)">
                    <span class="provider-label">{{ getProviderDisplayLabel(selectedSession.provider) }}</span>
                  </span>
                  <button
                    type="button"
                    class="app-btn-ghost session-review-chip session-review-trigger session-review-chip--inline"
                    :data-status="getSessionReviewStatus(selectedSession)"
                    :disabled="updatingSessionReviewId === selectedSession.id"
                    @click="openReviewStatusModal"
                  >
                    {{ getSessionReviewLabel(selectedSession) }}
                  </button>
                  <span
                    v-if="getSessionSyncStatus(selectedSession) !== 'active'"
                    class="session-review-chip session-sync-chip"
                    :data-status="getSessionSyncStatus(selectedSession)"
                  >
                    {{ getSessionSyncLabel(selectedSession) }}
                  </span>
                  <span class="meta-dot">·</span>
                  <span class="meta-time">{{ formatTime(selectedSession.updatedAt) }}</span>
                </p>
                <div class="matched-turn-strip" v-if="hasMatchedEvidence(selectedSession)">
                  <span class="matched-turn-summary">{{ getMatchMode(selectedSession) }}</span>
                  <button
                    v-for="turnIndex in getMatchedTurns(selectedSession)"
                    :key="`${selectedSession.id}-detail-turn-${turnIndex}`"
                    type="button"
                    class="app-btn-ghost matched-turn-pill"
                    @click="jumpToTurnIndex(turnIndex)"
                  >
                    {{ getMatchedTurnLabel(turnIndex) }}
                  </button>
                  <button
                    type="button"
                    class="app-btn-ghost matched-turn-detail-btn"
                    @click="openMatchedEvidence(selectedSession)"
                  >
                    <Brain :size="14" />
                    命中详情
                    <span>{{ getMatchedChunkCount(selectedSession) }}</span>
                  </button>
                </div>
              </div>
              <div class="detail-head-actions">
                <div class="user-anchor-nav" v-if="userAnchorIds.length">
                  <button type="button" class="app-btn-ghost user-anchor-btn" @click="jumpToUserAnchor('prev')" :disabled="userAnchorIds.length < 2" title="上一个提问">
                    <ChevronUp :size="16" />
                  </button>
                  <button type="button" class="app-btn-ghost user-anchor-btn" @click="jumpToUserAnchor('next')" :disabled="userAnchorIds.length < 2" title="下一个提问">
                    <ChevronDown :size="16" />
                  </button>
                </div>
                <button
                  type="button"
                  class="app-btn-ghost detail-delete-btn"
                  @click="openDeleteConfirm(selectedSession)"
                  :title="deletingSessionId === selectedSession.id ? '删除中' : '删除会话'"
                  :aria-label="deletingSessionId === selectedSession.id ? '删除中' : '删除会话'"
                  :disabled="deletingSessionId === selectedSession.id"
                >
                  <RefreshCw v-if="deletingSessionId === selectedSession.id" :size="14" class="animate-spin" />
                  <Trash2 v-else :size="14" />
                </button>
              </div>
            </header>

            <div class="flow" ref="flowRef">
              <article
                v-for="node in selectedSessionFlow"
                :key="node.id"
                class="flow-node"
                :class="{ 'node-anchored': anchoredNodeId === node.id }"
                :data-role="node.role"
                :ref="(el) => setFlowNodeRef(node, el as Element | null)"
              >
                <div class="flow-meta">
                  <strong>
                    <User v-if="node.role === 'user'" :size="14" class="role-icon" />
                    <Sparkles v-else-if="node.role === 'assistant'" :size="14" class="role-icon" />
                    <Terminal v-else :size="14" class="role-icon" />
                    {{ node.role }}
                  </strong>
                  <div class="flow-meta-right">
                    <small>{{ formatTime(node.createdAt) }}</small>
                    <button
                      v-if="node.role === 'user'"
                      type="button"
                      class="app-btn-ghost node-score-btn"
                      @click="openPromptScoreModal(node)"
                    >
                      <Target :size="12" class="icon-label"/> 评分
                    </button>
                    <button type="button" class="app-btn-ghost node-tag-btn" @click="openTagModal(node)">
                      <Tags :size="12" class="icon-label"/> 标签
                    </button>
                  </div>
                </div>
                <div class="message-tag-list" v-if="node.tags.length">
                  <span class="msg-tag-chip" v-for="tag in node.tags" :key="`${node.id}-tag-${tag}`">{{ tag }}</span>
                </div>

                <div class="flow-body" v-if="node.role !== 'assistant'">
                  <MarkdownContent
                    v-for="(chunk, idx) in node.chunks"
                    :key="`${node.id}-${idx}`"
                    class="md-content"
                    :content="chunk.content"
                  />
                </div>

                <div class="assistant-flow" v-else>
                  <details class="assistant-reasoning" v-if="node.reasoningChunks.length">
                    <summary>思考过程（{{ node.reasoningChunks.length }}）</summary>
                    <div class="assistant-reasoning-body">
                      <div class="assistant-step assistant-step-reasoning" v-for="(chunk, idx) in node.reasoningChunks" :key="`${node.id}-reason-${idx}`">
                        <span class="assistant-dot" />
                        <MarkdownContent class="md-content" :content="chunk.content" />
                      </div>
                    </div>
                  </details>

                  <div class="assistant-step" v-for="(chunk, idx) in getAssistantDisplayChunks(node)" :key="`${node.id}-${idx}`">
                    <span class="assistant-dot" />
                    <MarkdownContent class="md-content" :content="chunk.content" />
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section class="panel-soft detail loading-detail" v-else-if="loading">
            <header>
              <div class="skeleton skeleton-text medium" style="height: 2rem;"></div>
              <div class="skeleton skeleton-text short"></div>
            </header>
            <div class="flow">
              <div v-for="i in 3" :key="`skel-msg-${i}`" class="flow-node" style="padding: 2rem; border-color: transparent;">
                <div class="skeleton skeleton-text medium"></div>
                <div class="skeleton skeleton-text long"></div>
                <div class="skeleton skeleton-text long"></div>
              </div>
            </div>
          </section>

          <section class="panel-soft detail empty" v-else>
            <div class="empty-dashboard-state">
              <div class="empty-state-icon">
                <Brain :size="38" />
              </div>
              <h1 class="empty-state-title">{{ filteredSessions.length ? '从左侧选择一个会话' : '开启你的 AI 记忆库' }}</h1>
              <p class="empty-state-desc">
                {{ filteredSessions.length
                  ? '会话列表已经准备好，先选择一个结果，再在右侧查看完整对话、标签和命中证据。'
                  : '当前范围内还没有可读会话。你可以先导入数据，或者刷新当前筛选条件重新检索。'
                }}
              </p>
              <div v-if="!filteredSessions.length" class="empty-state-actions">
                <button type="button" class="app-btn empty-cta-btn" @click="openImportModal">
                  <FolderOpen :size="18" /> 导入文件夹
                </button>
                <button type="button" class="app-btn-ghost empty-cta-btn" @click="loadSessions">
                  <RefreshCw :size="18" /> 刷新结果
                </button>
              </div>
            </div>
          </section>
        </Transition>
      </div>
</template>
