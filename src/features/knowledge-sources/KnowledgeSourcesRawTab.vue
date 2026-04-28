<script setup lang="ts">
import { computed, ref, unref } from 'vue'
import MarkdownContent from '@/components/MarkdownContent.vue'
import { AppDrawer } from '@/components/ui/drawer'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  IconDatabase,
  IconFileText,
  IconLink2,
  IconRefreshCw,
  IconSparkles,
  IconTriangleAlert,
} from '@/components/icons/app-icons'

const props = defineProps<{ ctx: Record<string, any> }>()

const {
  knowledgeItems,
  knowledgeLoading,
  knowledgeSaving,
  selectedKnowledgeItemId,
  filteredKnowledgeItems,
  knowledgeSourceTypeFilter,
  knowledgeStatusFilter,
  knowledgeIntakeStageFilter,
  knowledgeConfidenceFilter,
  knowledgeKeyword,
  sourceTypeOptions,
  statusOptions,
  intakeStageOptions,
  confidenceOptions,
  subtypeSuggestions,
  editorIntakeStageOption,
  editorConfidenceOption,
  editorId,
  editorSourceType,
  editorSourceSubtype,
  editorStatus,
  editorTitle,
  editorContent,
  editorSourceUrl,
  editorSourceFile,
  editorTagsInput,
  editorProject,
  editorTopic,
  editorIntakeStage,
  editorConfidence,
  editorKeyQuestion,
  editorDecisionNote,
  editorDuplicateCandidates,
  batchImportOpen,
  batchImportText,
  batchImportDuplicateMode,
  batchImportSaving,
  batchImportRows,
  batchImportReadyCount,
  batchImportDuplicateCount,
  batchImportMergeCount,
  batchImportError,
  openClawSyncOpen,
  openClawSyncLoading,
  openClawSyncImporting,
  openClawSyncPreview,
  openClawSyncRows,
  openClawSyncSummary,
  openClawSyncError,
  openClawSyncCanImport,
  loadKnowledgeItems,
  selectKnowledgeItem,
  startNewKnowledgeItem,
  saveKnowledgeItem,
  updateKnowledgeItemStatus,
  deleteKnowledgeItem,
  openBatchImport,
  closeBatchImport,
  saveBatchImport,
  openOpenClawSync,
  closeOpenClawSync,
  previewOpenClawSync,
  importOpenClawSync,
  loadPromotionQueue,
  setWorkbenchTab,
} = props.ctx

const itemsResolved = computed(() => {
  const list = unref(filteredKnowledgeItems) || unref(knowledgeItems)
  return Array.isArray(list) ? list : []
})
const intakeStageOptionsResolved = computed(() => {
  const list = unref(intakeStageOptions)
  return Array.isArray(list) ? list : []
})
const confidenceOptionsResolved = computed(() => {
  const list = unref(confidenceOptions)
  return Array.isArray(list) ? list : []
})
const editorIntakeStageOptionResolved = computed(() => unref(editorIntakeStageOption) || { label: 'Inbox', description: '' })
const editorConfidenceOptionResolved = computed(() => unref(editorConfidenceOption) || { label: '中', description: '' })
const editorDuplicateCandidatesResolved = computed(() => {
  const list = unref(editorDuplicateCandidates)
  return Array.isArray(list) ? list : []
})
const batchImportRowsResolved = computed(() => {
  const list = unref(batchImportRows)
  return Array.isArray(list) ? list : []
})

function normalizeOpenClawDuplicateTarget(reason: unknown) {
  const raw = String(reason || '').trim()
  if (!raw) return ''
  if (raw.startsWith('duplicate-of:')) return raw.slice('duplicate-of:'.length).trim()
  if (raw === 'duplicate-content') return ''
  return raw
}

const openClawSyncRowsResolved = computed(() => {
  const list = unref(openClawSyncRows)
  if (!Array.isArray(list)) return []
  const normalized = list.filter((row) => row && typeof row === 'object')
  if (!normalized.length) return []

  const baseRows = normalized
  const mergedRows: Array<Record<string, any>> = []
  const dedupGroups = new Map<string, Record<string, any>>()

  for (const item of baseRows) {
    const row = item as Record<string, any>
    const action = String(row?.action || '')
    if (action !== 'deduped') {
      mergedRows.push(row)
      continue
    }

    const duplicateTarget = normalizeOpenClawDuplicateTarget(row?.reason)
    const key = [
      String(row?.title || ''),
      String(row?.sourceType || ''),
      String(row?.sourceSubtype || ''),
      duplicateTarget,
    ].join('::')
    const existing = dedupGroups.get(key)
    if (!existing) {
      dedupGroups.set(key, {
        ...row,
        id: `deduped::${key}`,
        reason: duplicateTarget,
        duplicateCount: 1,
      })
      continue
    }

    existing.duplicateCount = Number(existing.duplicateCount || 1) + 1
    const currentPath = String(existing.openclawPath || '')
    const nextPath = String(row.openclawPath || '')
    if (nextPath && (!currentPath || nextPath.localeCompare(currentPath) > 0)) {
      existing.openclawPath = nextPath
    }
  }

  mergedRows.push(...Array.from(dedupGroups.values()))

  const rank: Record<string, number> = {
    new: 0,
    changed: 1,
    missing: 2,
    deduped: 3,
    imported: 4,
    archived: 5,
    unchanged: 6,
  }

  return mergedRows.sort((left, right) => {
    const leftAction = String(left?.action || '')
    const rightAction = String(right?.action || '')
    const leftRank = leftAction in rank ? rank[leftAction] : 99
    const rightRank = rightAction in rank ? rank[rightAction] : 99
    if (leftRank !== rightRank) return leftRank - rightRank
    return String(left?.openclawPath || '').localeCompare(String(right?.openclawPath || ''))
  })
})
const openClawSyncSummaryResolved = computed(() => unref(openClawSyncSummary) || {})
const openClawSyncRootResolved = computed(() => String(unref(openClawSyncPreview)?.root || '~/.openclaw/knowledge/inbox'))
const openClawSyncPromotionCountResolved = computed(() =>
  Number(unref(openClawSyncPreview)?.promotionQueue?.summary?.totalItems || 0),
)

const knowledgeEditorDialogOpen = ref(false)
const knowledgeEditorIntakeOpen = ref(true)
const knowledgeEditorSourceOpen = ref(true)
const knowledgeEditorContentMode = ref<'edit' | 'preview'>('edit')
const knowledgeSourceFileInputRef = ref<HTMLInputElement | null>(null)

function formatSourceTypeLabel(value: string) {
  if (value === 'note') return 'Note'
  if (value === 'document') return 'Document'
  return 'Capture'
}

function formatSourceTypeMark(value: string) {
  if (value === 'note') return '记'
  if (value === 'document') return '文'
  return '采'
}

function formatStatusLabel(value: string) {
  if (value === 'active') return 'Active'
  if (value === 'archived') return 'Archived'
  return 'Draft'
}

function getKnowledgeMetaValue(item: Record<string, any>, key: string) {
  return String(item?.meta?.[key] || '').trim()
}

function formatIntakeStageLabel(value: string) {
  return intakeStageOptionsResolved.value.find((item) => item.value === value)?.label || 'Inbox'
}

function formatConfidenceLabel(value: string) {
  return confidenceOptionsResolved.value.find((item) => item.value === value)?.label || '中'
}

function formatOpenClawSyncAction(value: string) {
  if (value === 'new') return '新增'
  if (value === 'changed') return '变更'
  if (value === 'missing') return '待归档'
  if (value === 'deduped') return '内容去重'
  if (value === 'unchanged') return '跳过'
  if (value === 'imported') return '已导入'
  if (value === 'archived') return '已归档'
  return value || '未知'
}

function formatOpenClawSyncReason(row: Record<string, any>) {
  const action = String(row?.action || '')
  const raw = String(row?.reason || '').trim()
  if (!raw) return ''

  if (action === 'deduped') {
    const target = normalizeOpenClawDuplicateTarget(raw)
    const count = Math.max(1, Number(row?.duplicateCount || 1))
    if (target) {
      return count > 1 ? `与 ${target} 重复（${count} 条）` : `与 ${target} 重复`
    }
    return count > 1 ? `内容重复（${count} 条）` : '内容重复'
  }

  if (raw === 'missing-from-openclaw') return '源目录已移除，已归档'
  if (raw === 'unchanged') return '内容未变化'
  if (raw === 'deduped') return '内容重复，已跳过'
  return raw
}

function formatKnowledgePromotionDecision(value: string) {
  if (value === 'approved') return '已升格'
  if (value === 'dismissed') return '已驳回'
  if (value === 'revoked') return '已撤销'
  return ''
}

function formatDateTime(value: unknown) {
  const normalized = String(value || '').trim()
  if (!normalized) return '-'
  const timestamp = new Date(normalized)
  if (Number.isNaN(timestamp.getTime())) return normalized
  return timestamp.toLocaleString()
}

function formatTagList(tags: unknown) {
  if (!Array.isArray(tags) || !tags.length) return ''
  return tags.map((item) => String(item || '').trim()).filter(Boolean).join(' · ')
}

function compactMarkdownPreview(value: unknown, limit = 420) {
  const normalized = String(value || '')
    .replace(/```[\s\S]*?```/g, ' 代码块 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return '暂无内容'
  return normalized.slice(0, limit)
}

function resolveKnowledgeMarkdownSource(content: unknown): string {
  const source = String(content || '').trim()
  return source || '还没有内容，适合先把 Markdown、网页摘录、聊天片段或终端输出粘进来。'
}

function openKnowledgeItemEditor(item: Record<string, any>) {
  selectKnowledgeItem(item)
  knowledgeEditorIntakeOpen.value = true
  knowledgeEditorSourceOpen.value = true
  knowledgeEditorContentMode.value = 'edit'
  knowledgeEditorDialogOpen.value = true
}

function openNewKnowledgeItemEditor(sourceType: 'capture' | 'note' | 'document' = 'capture') {
  startNewKnowledgeItem(sourceType)
  knowledgeEditorIntakeOpen.value = false
  knowledgeEditorSourceOpen.value = false
  knowledgeEditorContentMode.value = 'edit'
  knowledgeEditorDialogOpen.value = true
}

function setEditorSourceType(sourceType: 'capture' | 'note' | 'document') {
  editorSourceType.value = sourceType
  const defaultSubtypeBySourceType = {
    capture: 'manual',
    note: 'daily-note',
    document: 'article',
  }
  editorSourceSubtype.value = defaultSubtypeBySourceType[sourceType]
}

function closeKnowledgeEditorDialog() {
  if (unref(knowledgeSaving)) return
  knowledgeEditorDialogOpen.value = false
}

function toggleKnowledgeEditorIntake() {
  knowledgeEditorIntakeOpen.value = !knowledgeEditorIntakeOpen.value
}

function toggleKnowledgeEditorSource() {
  knowledgeEditorSourceOpen.value = !knowledgeEditorSourceOpen.value
}

function setKnowledgeEditorContentMode(mode: 'edit' | 'preview') {
  knowledgeEditorContentMode.value = mode
}

function triggerKnowledgeSourceFileSelect() {
  knowledgeSourceFileInputRef.value?.click()
}

function onKnowledgeSourceFilePicked(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0] as (File & { path?: string, webkitRelativePath?: string }) | undefined
  const fallbackName = target.value.split(/[/\\]/).filter(Boolean).pop() || ''
  const selectedPath = file?.path || file?.webkitRelativePath || file?.name || fallbackName
  if (!selectedPath) return

  editorSourceFile.value = selectedPath
  target.value = ''
}

async function saveKnowledgeItemAndClose() {
  const saved = await saveKnowledgeItem()
  if (saved) {
    knowledgeEditorDialogOpen.value = false
  }
}

async function saveKnowledgeItemToPromotion() {
  editorStatus.value = 'active'
  editorIntakeStage.value = 'wiki-candidate'
  const saved = await saveKnowledgeItem()
  if (!saved) return
  const savedId = String(editorId.value || selectedKnowledgeItemId.value || '').trim()
  knowledgeEditorDialogOpen.value = false
  await setWorkbenchTab('promotion')
  await loadPromotionQueue(true)
}

async function deleteKnowledgeItemAndClose() {
  const deleted = await deleteKnowledgeItem()
  if (deleted) {
    knowledgeEditorDialogOpen.value = false
  }
}
</script>

<template>
  <section class="knowledge-sources-toolbar knowledge-sources-toolbar--stacked">
    <div class="knowledge-filter-group">
      <label>
        <small>来源层</small>
        <select v-model="knowledgeSourceTypeFilter" class="app-select" @change="loadKnowledgeItems">
          <option value="all">全部</option>
          <option value="capture">Capture</option>
          <option value="note">Note</option>
          <option value="document">Document</option>
        </select>
      </label>

      <label>
        <small>状态</small>
        <select v-model="knowledgeStatusFilter" class="app-select" @change="loadKnowledgeItems">
          <option value="visible">未归档</option>
          <option value="all">全部</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </label>

      <label>
        <small>去向</small>
        <select v-model="knowledgeIntakeStageFilter" class="app-select">
          <option value="all">全部</option>
          <option v-for="option in intakeStageOptionsResolved" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <label>
        <small>可信度</small>
        <select v-model="knowledgeConfidenceFilter" class="app-select">
          <option value="all">全部</option>
          <option v-for="option in confidenceOptionsResolved" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <label class="knowledge-filter-search">
        <small>关键词</small>
        <input
          v-model="knowledgeKeyword"
          class="app-input"
          type="text"
          placeholder="搜标题、内容、子类型或标签"
          @keyup.enter="loadKnowledgeItems"
        />
      </label>

      <button
        type="button"
        class="icon-btn"
        :disabled="knowledgeLoading"
        @click="loadKnowledgeItems"
        :title="knowledgeLoading ? '刷新中' : '刷新条目'"
        aria-label="刷新条目"
      >
        <IconRefreshCw v-if="knowledgeLoading" :size="18" class="animate-spin" />
        <IconRefreshCw v-else :size="18" />
      </button>
    </div>

  </section>

  <section class="knowledge-sources-layout knowledge-sources-layout--raw-list">
    <aside class="knowledge-sources-list">
      <header class="knowledge-list-head">
        <div>
          <div class="knowledge-list-title-row">
            <strong>原始条目</strong>
            <span class="knowledge-list-badge">{{ itemsResolved.length }}</span>
          </div>
          <small>可作为后续 wiki 编译的原料</small>
        </div>
        <div class="knowledge-list-head-actions">
          <button type="button" class="app-btn-ghost knowledge-openclaw-sync-btn" @click="openOpenClawSync">
            <IconRefreshCw :size="15" />
            <span>OpenClaw</span>
          </button>
          <button type="button" class="app-btn-ghost" @click="openBatchImport">批量导入</button>
          <button type="button" class="app-btn" @click="openNewKnowledgeItemEditor('capture')">新建条目</button>
        </div>
      </header>

      <div v-if="!itemsResolved.length" class="knowledge-list-empty">
        <IconSparkles :size="20" />
        <p>还没有条目，先从一个零散片段开始最合适。</p>
        <button type="button" class="app-btn" @click="openNewKnowledgeItemEditor('capture')">新建条目</button>
      </div>

      <div v-else class="knowledge-raw-card-grid">
        <button
          v-for="item in itemsResolved"
          :key="item.id"
          type="button"
          class="knowledge-list-item knowledge-raw-card"
          :class="{ active: selectedKnowledgeItemId === item.id }"
          @click="openKnowledgeItemEditor(item)"
        >
          <div class="knowledge-list-item-top">
            <span class="knowledge-chip" :data-type="item.sourceType">{{ formatSourceTypeLabel(item.sourceType) }}</span>
            <span class="knowledge-chip status" :data-status="item.status">{{ formatStatusLabel(item.status) }}</span>
          </div>
          <div class="knowledge-list-item-route">
            <span class="knowledge-chip route" :data-route="getKnowledgeMetaValue(item, 'intakeStage') || 'inbox'">
              {{ formatIntakeStageLabel(getKnowledgeMetaValue(item, 'intakeStage')) }}
            </span>
            <span class="knowledge-chip confidence" :data-confidence="getKnowledgeMetaValue(item, 'confidence') || 'medium'">
              可信度 {{ formatConfidenceLabel(getKnowledgeMetaValue(item, 'confidence')) }}
            </span>
            <span
              v-if="formatKnowledgePromotionDecision(getKnowledgeMetaValue(item, 'promotionDecision'))"
              class="knowledge-chip promotion"
              :data-promotion="getKnowledgeMetaValue(item, 'promotionDecision')"
            >
              {{ formatKnowledgePromotionDecision(getKnowledgeMetaValue(item, 'promotionDecision')) }}
            </span>
          </div>
          <strong>{{ item.title || '未命名条目' }}</strong>
          <p>{{ compactMarkdownPreview(item.content) }}</p>
          <div v-if="getKnowledgeMetaValue(item, 'keyQuestion')" class="knowledge-raw-card-question">
            <span>问题</span>
            <small>{{ getKnowledgeMetaValue(item, 'keyQuestion') }}</small>
          </div>
          <div class="knowledge-list-item-meta">
            <span v-if="getKnowledgeMetaValue(item, 'project')">{{ getKnowledgeMetaValue(item, 'project') }}</span>
            <span v-if="getKnowledgeMetaValue(item, 'topic')">{{ getKnowledgeMetaValue(item, 'topic') }}</span>
            <span v-else-if="item.sourceSubtype">{{ item.sourceSubtype }}</span>
            <span>{{ formatDateTime(item.updatedAt) }}</span>
          </div>
          <small v-if="formatTagList(item.tags)" class="knowledge-list-item-note">{{ formatTagList(item.tags) }}</small>
        </button>
      </div>
    </aside>

    <AppDrawer
      :open="knowledgeEditorDialogOpen"
      :title="editorId ? '编辑条目' : '新建条目'"
      description="先把原始内容录进来，再补齐去向、可信度和来源信息。"
      size="xl"
      @close="closeKnowledgeEditorDialog"
    >
      <template #eyebrow>
        Knowledge Intake Drawer
      </template>

      <div class="knowledge-editor-drawer-body">
        <section v-if="!editorId" class="knowledge-editor-create-type">
          <header class="knowledge-editor-section-head">
            <div>
              <strong>选择条目类型</strong>
              <small>类型会影响默认子类型和后续分流口径。</small>
            </div>
          </header>
          <button
            v-for="option in sourceTypeOptions"
            :key="option.value"
            type="button"
            class="app-btn-ghost knowledge-editor-create-type-btn"
            :class="{ active: editorSourceType === option.value }"
            @click="setEditorSourceType(option.value)"
          >
            <span class="knowledge-editor-create-type-icon" :data-type="option.value">
              {{ formatSourceTypeMark(option.value) }}
            </span>
            <span class="knowledge-editor-create-type-copy">
              <strong>{{ option.label }}</strong>
              <small>{{ option.description }}</small>
            </span>
          </button>
        </section>

        <section class="knowledge-editor-main-column">
          <div class="knowledge-editor-section">
            <header class="knowledge-editor-section-head">
              <div>
                <strong>原始内容</strong>
                <small>先保留事实材料本身，后续判断放到右侧。</small>
              </div>
            </header>
            <label class="knowledge-editor-field knowledge-editor-field--title">
              <small>标题</small>
              <input v-model="editorTitle" class="app-input" type="text" placeholder="一句话标记这条内容的主题" />
            </label>

            <div class="knowledge-editor-field knowledge-editor-field--content">
              <div class="knowledge-editor-content-head">
                <small>内容，支持 Markdown</small>
                <div class="knowledge-editor-content-tabs" role="tablist" aria-label="内容编辑模式">
                  <button
                    type="button"
                    class="app-btn-ghost"
                    :class="{ active: knowledgeEditorContentMode === 'edit' }"
                    :aria-selected="knowledgeEditorContentMode === 'edit'"
                    @click="setKnowledgeEditorContentMode('edit')"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    class="app-btn-ghost"
                    :class="{ active: knowledgeEditorContentMode === 'preview' }"
                    :aria-selected="knowledgeEditorContentMode === 'preview'"
                    @click="setKnowledgeEditorContentMode('preview')"
                  >
                    预览
                  </button>
                </div>
              </div>
              <textarea
                v-if="knowledgeEditorContentMode === 'edit'"
                v-model="editorContent"
                class="app-textarea knowledge-editor-textarea"
                placeholder="支持 Markdown。可以粘贴网页摘录、聊天片段、命令输出或自己的想法"
              />
              <MarkdownContent
                v-else
                class="knowledge-editor-markdown-preview md-content compact-md"
                :content="resolveKnowledgeMarkdownSource(editorContent)"
              />
            </div>
          </div>

          <section v-if="editorDuplicateCandidatesResolved.length" class="knowledge-duplicate-panel">
            <header class="knowledge-duplicate-panel-head">
              <IconTriangleAlert :size="16" />
              <div>
                <strong>可能重复</strong>
                <small>保存前先确认是否已经采过，避免 Raw Inbox 继续堆冗余项。</small>
              </div>
            </header>
            <button
              v-for="candidate in editorDuplicateCandidatesResolved"
              :key="candidate.item.id"
              type="button"
              class="knowledge-duplicate-item"
              @click="selectKnowledgeItem(candidate.item)"
            >
              <span>{{ candidate.reason || '内容相近' }}</span>
              <strong>{{ candidate.item.title || '未命名条目' }}</strong>
              <small>{{ formatDateTime(candidate.item.updatedAt) }}</small>
            </button>
          </section>
        </section>

        <aside class="knowledge-editor-side-column">
          <section class="knowledge-editor-section knowledge-editor-disclosure">
            <button
              type="button"
              class="knowledge-editor-section-head knowledge-editor-disclosure-head"
              :aria-expanded="knowledgeEditorIntakeOpen"
              @click="toggleKnowledgeEditorIntake"
            >
              <div>
                <strong>采集判断</strong>
                <small>这组信息决定后续进入哪条处理队列。</small>
              </div>
              <span class="knowledge-editor-disclosure-meta">
                <span class="knowledge-chip route" :data-route="editorIntakeStage">
                  {{ editorIntakeStageOptionResolved.label }}
                </span>
                <span class="knowledge-editor-disclosure-indicator">
                  {{ knowledgeEditorIntakeOpen ? '收起' : '展开' }}
                </span>
              </span>
            </button>

            <div v-show="knowledgeEditorIntakeOpen" class="knowledge-editor-disclosure-body">
              <div class="knowledge-editor-grid knowledge-editor-grid--compact">
                <label>
                  <small>项目 / 工作流</small>
                  <input v-model="editorProject" class="app-input" type="text" placeholder="myLocalRAG / srs-h5" />
                </label>

                <label>
                  <small>主题</small>
                  <input v-model="editorTopic" class="app-input" type="text" placeholder="采集流程 / embedding" />
                </label>

                <label>
                  <small>下一步去向</small>
                  <select v-model="editorIntakeStage" class="app-select">
                    <option v-for="option in intakeStageOptionsResolved" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>

                <label>
                  <small>可信度</small>
                  <select v-model="editorConfidence" class="app-select">
                    <option v-for="option in confidenceOptionsResolved" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>
              </div>

              <label class="knowledge-editor-field knowledge-editor-field--question">
                <small>核心问题</small>
                <input v-model="editorKeyQuestion" class="app-input" type="text" placeholder="这条原料主要回答什么问题？" />
              </label>

              <label class="knowledge-editor-field knowledge-editor-field--decision-note">
                <small>处理备注</small>
                <textarea
                  v-model="editorDecisionNote"
                  class="app-textarea knowledge-editor-note-textarea"
                  placeholder="还缺什么上下文、为什么值得保留、后续应该怎么处理"
                />
              </label>
            </div>
          </section>

          <section class="knowledge-editor-section knowledge-editor-disclosure">
            <button
              type="button"
              class="knowledge-editor-section-head knowledge-editor-disclosure-head"
              :aria-expanded="knowledgeEditorSourceOpen"
              @click="toggleKnowledgeEditorSource"
            >
              <div>
                <strong>来源信息</strong>
                <small>用于回源、检索和后续编译。</small>
              </div>
              <span class="knowledge-editor-disclosure-indicator">
                {{ knowledgeEditorSourceOpen ? '收起' : '展开' }}
              </span>
            </button>

            <div v-show="knowledgeEditorSourceOpen" class="knowledge-editor-disclosure-body">
              <div class="knowledge-editor-grid knowledge-editor-grid--compact">
                <label>
                  <small>来源层</small>
                  <select v-model="editorSourceType" class="app-select">
                    <option v-for="option in sourceTypeOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>

                <label>
                  <small>状态</small>
                  <select v-model="editorStatus" class="app-select">
                    <option v-for="option in statusOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </label>

                <label>
                  <small>子类型</small>
                  <input
                    v-model="editorSourceSubtype"
                    class="app-input"
                    list="knowledge-subtype-suggestions"
                    placeholder="manual / article..."
                  />
                  <datalist id="knowledge-subtype-suggestions">
                    <option v-for="item in subtypeSuggestions" :key="item" :value="item" />
                  </datalist>
                </label>

                <label>
                  <small>标签</small>
                  <input v-model="editorTagsInput" class="app-input" type="text" placeholder="rag, obsidian" />
                </label>
              </div>

              <label class="knowledge-editor-field">
                <small>来源链接</small>
                <div class="knowledge-input-with-icon">
                  <IconLink2 :size="16" />
                  <input v-model="editorSourceUrl" class="app-input" type="text" placeholder="https://..." />
                </div>
              </label>

              <div class="knowledge-editor-field">
                <small>来源文件</small>
                <input
                  ref="knowledgeSourceFileInputRef"
                  type="file"
                  hidden
                  @change="onKnowledgeSourceFilePicked"
                />
                <div class="knowledge-source-file-picker">
                  <div class="knowledge-input-with-icon">
                    <IconFileText :size="16" />
                    <input v-model="editorSourceFile" class="app-input" type="text" placeholder="/path/to/file.md" />
                  </div>
                  <button
                    type="button"
                    class="app-btn-ghost knowledge-source-file-picker-btn"
                    @click="triggerKnowledgeSourceFileSelect"
                  >
                    选择文件
                  </button>
                </div>
              </div>
            </div>
          </section>

        </aside>
      </div>

      <template #footer>
        <div class="knowledge-drawer-footer">
          <details class="knowledge-drawer-more-actions">
            <summary>更多操作</summary>
            <div class="knowledge-drawer-more-menu">
              <small v-if="!editorId" class="knowledge-drawer-more-hint">保存后可进行状态流转和删除。</small>
              <button type="button" class="app-btn-ghost" @click="updateKnowledgeItemStatus('draft')" :disabled="!editorId || knowledgeSaving">
                转为 Draft
              </button>
              <button type="button" class="app-btn-ghost" @click="updateKnowledgeItemStatus('active')" :disabled="!editorId || knowledgeSaving">
                标为 Active
              </button>
              <button type="button" class="app-btn-ghost knowledge-editor-danger-btn" @click="updateKnowledgeItemStatus('archived')" :disabled="!editorId || knowledgeSaving">
                归档
              </button>
              <button type="button" class="app-btn-ghost knowledge-editor-danger-btn" @click="deleteKnowledgeItemAndClose" :disabled="!editorId || knowledgeSaving">
                删除
              </button>
            </div>
          </details>
          <div class="knowledge-drawer-primary-actions">
            <button type="button" class="app-btn-ghost" @click="closeKnowledgeEditorDialog" :disabled="knowledgeSaving">
              取消
            </button>
            <button type="button" class="app-btn-ghost" @click="saveKnowledgeItemToPromotion" :disabled="knowledgeSaving">
              保存并送升格审核
            </button>
            <button type="button" class="app-btn" @click="saveKnowledgeItemAndClose" :disabled="knowledgeSaving">
              {{ knowledgeSaving ? '保存中...' : editorId ? '保存条目' : '创建条目' }}
            </button>
          </div>
        </div>
      </template>
    </AppDrawer>
  </section>

  <Dialog :open="openClawSyncOpen" @update:open="(open) => { if (!open) closeOpenClawSync() }">
    <DialogContent class="knowledge-openclaw-sync-dialog" :show-close="false">
      <DialogHeader>
        <DialogTitle>同步 OpenClaw</DialogTitle>
        <DialogDescription>
          从 OpenClaw inbox 读取增量知识，确认后写入 Raw Inbox，并刷新升格审核队列。
        </DialogDescription>
      </DialogHeader>

      <div class="knowledge-openclaw-sync-metrics">
        <span class="knowledge-openclaw-sync-metric-root" :title="openClawSyncRootResolved">
          <small>同步目录</small>
          <strong>{{ openClawSyncRootResolved }}</strong>
        </span>
        <span><small>扫描</small><strong>{{ openClawSyncSummaryResolved.scanned || openClawSyncSummaryResolved.total || 0 }}</strong></span>
        <span><small>新增</small><strong>{{ openClawSyncSummaryResolved.new || 0 }}</strong></span>
        <span><small>变更</small><strong>{{ openClawSyncSummaryResolved.changed || 0 }}</strong></span>
        <span><small>减少</small><strong>{{ openClawSyncSummaryResolved.missing || openClawSyncSummaryResolved.archived || 0 }}</strong></span>
        <span><small>去重</small><strong>{{ openClawSyncSummaryResolved.deduped || 0 }}</strong></span>
        <span><small>跳过</small><strong>{{ openClawSyncSummaryResolved.unchanged || openClawSyncSummaryResolved.skipped || 0 }}</strong></span>
        <span><small>导入</small><strong>{{ openClawSyncSummaryResolved.imported || 0 }}</strong></span>
        <span><small>问题</small><strong>{{ openClawSyncSummaryResolved.issues || openClawSyncSummaryResolved.failed || 0 }}</strong></span>
      </div>

      <p v-if="openClawSyncError" class="knowledge-batch-import-error">{{ openClawSyncError }}</p>

      <div v-if="openClawSyncLoading" class="knowledge-list-empty knowledge-openclaw-sync-empty">
        <IconRefreshCw :size="18" class="animate-spin" />
        <p>正在读取 OpenClaw inbox...</p>
      </div>

      <div v-else-if="!openClawSyncRowsResolved.length" class="knowledge-list-empty knowledge-openclaw-sync-empty">
        <IconDatabase :size="18" />
        <p>还没有可预览的 OpenClaw 条目。</p>
      </div>

      <div v-else class="knowledge-openclaw-sync-list">
        <article
          v-for="row in openClawSyncRowsResolved"
          :key="row.id"
          class="knowledge-openclaw-sync-row"
          :data-action="row.action"
        >
          <div>
            <strong>
              {{ row.title || row.openclawPath }}
              <template v-if="Number(row.duplicateCount || 0) > 1">（×{{ Number(row.duplicateCount || 0) }}）</template>
            </strong>
            <p>{{ row.openclawPath }}</p>
          </div>
          <div class="knowledge-openclaw-sync-row-meta">
            <span class="knowledge-openclaw-sync-chip knowledge-openclaw-sync-chip--action" :data-action="row.action">
              {{ formatOpenClawSyncAction(row.action) }}
            </span>
            <span
              class="knowledge-openclaw-sync-chip knowledge-openclaw-sync-chip--source"
              :data-source-type="row.sourceType"
            >
              {{ formatSourceTypeLabel(row.sourceType) }} · {{ row.sourceSubtype || 'unknown' }}
            </span>
            <span
              class="knowledge-openclaw-sync-chip knowledge-openclaw-sync-chip--stage"
              :data-stage="row.intakeStage"
            >
              {{ formatIntakeStageLabel(row.intakeStage) }}
            </span>
            <span v-if="row.reason" class="knowledge-openclaw-sync-chip knowledge-openclaw-sync-chip--reason">
              {{ formatOpenClawSyncReason(row) }}
            </span>
          </div>
        </article>
      </div>

      <footer class="component-confirm-actions">
        <button
          type="button"
          class="app-btn-ghost"
          @click="previewOpenClawSync"
          :disabled="openClawSyncLoading || openClawSyncImporting"
        >
          {{ openClawSyncLoading ? '预览中...' : '重新预览' }}
        </button>
        <button
          type="button"
          class="app-btn-ghost"
          @click="closeOpenClawSync"
          :disabled="openClawSyncLoading || openClawSyncImporting"
        >
          关闭
        </button>
        <button
          type="button"
          class="app-btn"
          @click="importOpenClawSync"
          :disabled="openClawSyncLoading || openClawSyncImporting || !openClawSyncCanImport"
        >
          {{ openClawSyncImporting ? '同步中...' : `确认同步 ${Number(openClawSyncSummaryResolved.new || 0) + Number(openClawSyncSummaryResolved.changed || 0) + Number(openClawSyncSummaryResolved.missing || 0)} 条` }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="batchImportOpen" @update:open="(open) => { if (!open) closeBatchImport() }">
    <DialogContent class="knowledge-batch-import-dialog" :show-close="false">
      <DialogHeader>
        <DialogTitle>批量导入 Raw Inbox</DialogTitle>
        <DialogDescription>
          粘贴 JSON 数组或包含 items 的对象，导入前会按来源链接、标题和正文指纹提示重复。
        </DialogDescription>
      </DialogHeader>

      <div class="knowledge-batch-import-grid">
        <label class="knowledge-batch-import-input">
          <small>JSON 数据</small>
          <textarea
            v-model="batchImportText"
            class="app-textarea knowledge-batch-import-textarea"
            spellcheck="false"
            placeholder='{"items":[{"title":"...","content":"...","meta":{"intakeStage":"wiki-candidate"}}]}'
          ></textarea>
        </label>

        <aside class="knowledge-batch-import-preview">
          <div class="knowledge-batch-import-summary">
            <span>识别 {{ batchImportRowsResolved.length }} 条</span>
            <span>可处理 {{ batchImportReadyCount || 0 }} 条</span>
            <span>疑似重复 {{ batchImportDuplicateCount || 0 }} 条</span>
            <span v-if="batchImportMergeCount">将合并 {{ batchImportMergeCount }} 条</span>
          </div>
          <div class="knowledge-batch-import-mode" aria-label="重复处理方式">
            <label>
              <input v-model="batchImportDuplicateMode" type="radio" value="merge" />
              <span>合并已有，跳过批内重复</span>
            </label>
            <label>
              <input v-model="batchImportDuplicateMode" type="radio" value="skip" />
              <span>跳过所有疑似重复</span>
            </label>
            <label>
              <input v-model="batchImportDuplicateMode" type="radio" value="keep" />
              <span>仍然创建新条目</span>
            </label>
          </div>
          <p v-if="batchImportError" class="knowledge-batch-import-error">{{ batchImportError }}</p>

          <div v-if="batchImportRowsResolved.length" class="knowledge-batch-import-list">
            <article
              v-for="row in batchImportRowsResolved"
              :key="row.importId"
              class="knowledge-batch-import-row"
              :data-skipped="row.skipped ? 'true' : 'false'"
            >
              <div>
                <strong>{{ row.title || '未命名条目' }}</strong>
                <p>{{ compactMarkdownPreview(row.content || row.summary || '') }}</p>
              </div>
              <div class="knowledge-batch-import-meta">
                <span>{{ formatSourceTypeLabel(row.sourceType) }}</span>
                <span>{{ formatIntakeStageLabel(row.intakeStage) }}</span>
                <span v-if="row.project">{{ row.project }}</span>
                <span v-if="row.duplicateAction === 'merge'">将合并</span>
                <span v-if="row.skipped">将跳过</span>
              </div>
              <small v-if="row.duplicates.length" class="knowledge-batch-import-duplicate">
                相似：{{ row.duplicates[0].title }} · {{ row.duplicates[0].reason }} · {{ row.duplicates[0].score }}
              </small>
            </article>
          </div>
          <div v-else class="knowledge-list-empty knowledge-batch-import-empty">
            <IconDatabase :size="18" />
            <p>等待粘贴 JSON 数据。</p>
          </div>
        </aside>
      </div>

      <footer class="component-confirm-actions">
        <button type="button" class="app-btn-ghost" @click="closeBatchImport" :disabled="batchImportSaving">
          取消
        </button>
        <button
          type="button"
          class="app-btn"
          @click="saveBatchImport"
          :disabled="batchImportSaving || Boolean(batchImportError) || !batchImportReadyCount"
        >
          {{ batchImportSaving ? '处理中...' : `处理 ${batchImportReadyCount || 0} 条` }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
/* CSS migration is a separate task */
</style>
