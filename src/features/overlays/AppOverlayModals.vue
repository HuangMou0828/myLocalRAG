<script setup lang="ts">
import { computed } from 'vue'
import CodeSyntaxBlock from '@/components/CodeSyntaxBlock.vue'
import { IconBug, IconCopy, IconLink2, IconSparkles } from '@/components/icons/app-icons'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogScrollContent, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'

const props = defineProps<{ ctx: Record<string, any> }>()

const {
  uiToastQueue,
  removeUiToast,
  importModalOpen,
  closeImportModal,
  folderInputRef,
  onFolderPicked,
  importForm,
  activeProviderLabel,
  triggerFolderSelect,
  previewing,
  importing,
  resetImportSelection,
  previewImport,
  importFiles,
  importFolder,
  importPreview,
  quickCaptureOpen,
  closeQuickCapture,
  quickCaptureSaving,
  quickCaptureMode,
  quickCaptureSourceType,
  quickCaptureTitle,
  quickCaptureContent,
  quickCaptureSourceUrl,
  quickCaptureTagsInput,
  quickCaptureMarkActive,
  quickCaptureProject,
  quickCaptureTopic,
  quickCaptureIntakeStage,
  quickCaptureConfidence,
  quickCaptureDecisionNote,
  quickCapturePreview,
  quickCaptureBatchEntries,
  quickCaptureCanSave,
  quickCaptureSummary,
  saveQuickCapture,
  modelSettingsOpen,
  closeModelSettings,
  modelSettingsLoading,
  modelSettingsSaving,
  modelSettingsDraft,
  selectedModelSettingsItem,
  modelSettingsTesting,
  modelSettingsTestResults,
  saveModelSettings,
  resetModelSettingsDraft,
  testSelectedModelSettings,
  feishuProjectSettingsOpen,
  closeFeishuProjectSettings,
  feishuProjectSettingsLoading,
  feishuProjectSettingsSaving,
  feishuProjectSettingsError,
  feishuProjectSettings,
  feishuProjectSettingsDraft,
  feishuProjectSettingsModeLabel,
  resetFeishuProjectSettingsDraft,
  saveFeishuProjectSettings,
  embeddingBuildModalOpen,
  closeEmbeddingBuildModal,
  embeddingBuildMode,
  embeddingBuildStats,
  embeddingBuildStatsLoading,
  embeddingBuildPreview,
  embeddingBuildPreviewLoading,
  embeddingBuildJob,
  rebuildingEmbeddings,
  rebuildSessionEmbeddings,
  loadEmbeddingBuildPreview,
  wikiVaultSyncModalOpen,
  closeWikiVaultSyncModal,
  wikiVaultSyncMode,
  wikiVaultSyncStats,
  wikiVaultSyncStatsLoading,
  wikiVaultSyncPreview,
  wikiVaultSyncPreviewLoading,
  wikiVaultSyncJob,
  syncingWikiVault,
  wikiVaultProviderLabel,
  wikiVaultCanStart,
  loadWikiVaultSyncPreview,
  startWikiVaultSync,
  patchDirSettingsOpen,
  closePatchDirSettings,
  patchDirDraftAlias,
  patchDirDraftPath,
  patchDirAdding,
  patchDirEditingPresetId,
  patchDirTotal,
  editingPatchDirPreset,
  selectedPatchDirPreset,
  startEditPatchDirPreset,
  cancelEditPatchDirPreset,
  addPatchDirPreset,
  patchDirPresets,
  selectedPatchDirPresetId,
  removePatchDirPreset,
  deleteConfirmOpen,
  closeDeleteConfirm,
  pendingDeleteSession,
  getSessionDisplayTitle,
  deletingSessionId,
  confirmDeleteSession,
  bugInboxDeleteConfirmOpen,
  closeBugInboxDeleteConfirm,
  bugInboxPendingDelete,
  bugInboxDeletingId,
  confirmDeleteBugInbox,
  feishuBatchModalOpen,
  closeFeishuBatchModal,
  selectedFeishuTodos,
  feishuBatchAction,
  feishuBatchLoading,
  feishuBatchRollbackReason,
  feishuBatchError,
  feishuBatchResultText,
  submitFeishuBatchTransition,
  tagModalOpen,
  closeTagModal,
  tagModalTarget,
  presetTags,
  tagModalSelected,
  toggleTagSelection,
  tagModalSaving,
  saveMessageTags,
  promptScoreModalOpen,
  closePromptScoreModal,
  promptScoreLoading,
  promptScoreError,
  promptScoreTaskType,
  promptScoreResult,
  promptEffectAssessmentLoading,
  promptEffectAssessmentCacheLoading,
  promptEffectAssessmentError,
  promptEffectAssessmentResult,
  getScoreRingStyle,
  getScoreBand,
  getPromptTaskTypeLabel,
  getPromptVerdictLabel,
  getPromptScoreDimensions,
  severityLabel,
  promptScoreTargetText,
  runPromptEffectAssessment,
  promptOptimizeLanguage,
  promptOptimizeLoading,
  runPromptOptimize,
  promptOptimizeResult,
  promptOptimizeError,
  formatTime,
  renderMarkdown,
  stripOuterCodeFence,
  collectPromptSources,
  getSourceRadar,
  getSourceLegend,
  feishuBindModalOpen,
  closeFeishuBindModal,
  feishuBindTargetBug,
  feishuBindLoading,
  feishuBindError,
  feishuBindCandidates,
  getFeishuCandidateKey,
  isFeishuCandidateSelected,
  feishuBindLinkingKey,
  selectFeishuCandidate,
  getFeishuCandidateStatusTone,
  getFeishuCandidateAvatarText,
  getFeishuCandidateSeverity,
  getFeishuCandidateSeverityLevel,
  isFeishuCurrentBoundCandidate,
  getFeishuCandidateReporter,
  getFeishuCandidateCreatedAt,
  getFeishuCandidateRequirement,
  getFeishuCandidateDiscoveryStage,
  getFeishuCandidateCategory,
  confirmFeishuBindSelection,
  feishuBindSelectedCandidateKey,
  bugInboxDetailModalOpen,
  closeBugInboxDetail,
  bugInboxDetailFields,
  copyBugDetailField,
} = props.ctx

function isLikelyJson(text: string): boolean {
  const value = String(text || '').trim()
  if (!value || !/^[\[{]/.test(value)) return false
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

function inferBugDetailCodeLanguage(field: Record<string, any>): string {
  const key = String(field?.key || '').toLowerCase()
  const label = String(field?.label || '').toLowerCase()
  const content = String(field?.display || '')
  const normalized = content.trim()

  if (/json/.test(key) || /json/.test(label) || isLikelyJson(normalized)) return 'json'
  if (/patch|diff/.test(key) || /^diff --git/m.test(normalized) || /^@@/m.test(normalized)) return 'diff'
  if (/markdown|md/.test(key) || /markdown|md/.test(label)) return 'markdown'
  if (/yaml|yml/.test(key) || /yaml|yml/.test(label)) return 'yaml'
  if (/xml|html/.test(key) || /xml|html/.test(label)) return 'xml'
  if (/python|py/.test(key) || /python|py/.test(label)) return 'python'
  if (/bash|shell|sh/.test(key) || /bash|shell|sh/.test(label)) return 'bash'
  if (/go/.test(key) || /go/.test(label)) return 'go'
  if (/java/.test(key) || /java/.test(label)) return 'java'
  if (/typescript|ts/.test(key) || /typescript|ts/.test(label)) return 'typescript'
  if (/javascript|js/.test(key) || /javascript|js/.test(label)) return 'javascript'

  return 'auto'
}

function getPromptEffectConfidence(value: unknown, verdict: string = 'unknown'): number {
  const numeric = Math.round(Number(value || 0))
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.max(0, Math.min(100, numeric))
  }
  if (verdict === 'strong') return 85
  if (verdict === 'usable') return 68
  if (verdict === 'weak') return 38
  return 0
}

function getPromptEffectSummaryLabel(key: string): string {
  const normalized = String(key || '').trim().toLowerCase()
  const labelMap: Record<string, string> = {
    summary: '摘要',
    overview: '整体判断',
    overall: '整体判断',
    conclusion: '结论',
    assessment: '评估',
    verdict: '结论',
    confidence: '置信度',
    expectedoutcome: '预期结果',
    expected_output: '预期结果',
    expectedquality: '预期质量',
    failuremodes: '失败风险',
    risks: '风险点',
    strengths: '优势点',
    weaknesses: '薄弱点',
    scenarios: '适用场景',
    assumptions: '前提假设',
    nextsteps: '建议动作',
    actionitems: '建议动作',
    notes: '补充说明',
    reason: '原因',
    reasoning: '判断依据',
    evidence: '证据',
    '结论': '结论',
    '摘要': '摘要',
    '总结': '总结',
    '整体判断': '整体判断',
    '优势': '优势',
    '风险': '风险',
    '风险点': '风险点',
    '建议': '建议',
    '原因': '原因',
    '说明': '说明',
    '判断依据': '判断依据',
    '前提假设': '前提假设',
    '适用场景': '适用场景',
  }
  return labelMap[normalized] || String(key || '').replace(/[_-]+/g, ' ').trim() || '补充信息'
}

function getPromptEffectSummaryText(value: unknown): string {
  if (typeof value === 'string') return stripOuterCodeFence(value).trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map((item) => getPromptEffectSummaryText(item))
      .filter(Boolean)
      .join('；')
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${getPromptEffectSummaryLabel(key)}：${getPromptEffectSummaryText(item)}`)
      .filter(Boolean)
      .join('；')
  }
  return ''
}

function extractPromptEffectJsonText(input: unknown): string {
  const raw = stripOuterCodeFence(String(input || '')).trim()
  if (!raw) return ''
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) return raw

  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fencedMatch?.[1]) return stripOuterCodeFence(fencedMatch[1])

  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) return raw.slice(firstBrace, lastBrace + 1)

  const firstBracket = raw.indexOf('[')
  const lastBracket = raw.lastIndexOf(']')
  if (firstBracket >= 0 && lastBracket > firstBracket) return raw.slice(firstBracket, lastBracket + 1)
  return ''
}

function parsePromptEffectJsonLoose(input: unknown): unknown {
  let candidate = extractPromptEffectJsonText(input)
  if (!candidate) return null

  for (let index = 0; index < 2; index += 1) {
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed === 'string') {
        candidate = parsed.trim()
        continue
      }
      return parsed
    } catch {
      return null
    }
  }

  return null
}

function parsePromptEffectSummary(raw: unknown) {
  const text = stripOuterCodeFence(String(raw || '')).trim()
  if (!text) return { lead: '', sections: [] as Array<Record<string, any>> }
  const parsed = parsePromptEffectJsonLoose(text)
  if (!parsed) {
    return { lead: text, sections: [] as Array<Record<string, any>> }
  }

  try {
    if (Array.isArray(parsed)) {
      const items = parsed.map((item) => getPromptEffectSummaryText(item)).filter(Boolean)
      return {
        lead: '',
        sections: items.length ? [{ title: '摘要要点', kind: 'list', items }] : [],
      }
    }

    if (parsed && typeof parsed === 'object') {
      const leadKeys = new Set(['summary', 'overview', 'overall', 'conclusion', 'assessment', '结论', '摘要', '总结', '整体判断'])
      let lead = ''
      const sections: Array<Record<string, any>> = []
      const pairs: Array<{ label: string; value: string }> = []

      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const label = getPromptEffectSummaryLabel(key)
        if (!lead && leadKeys.has(String(key || '').trim().toLowerCase())) {
          const textValue = getPromptEffectSummaryText(value)
          if (textValue) {
            lead = textValue
            continue
          }
        }

        if (Array.isArray(value)) {
          const items = value.map((item) => getPromptEffectSummaryText(item)).filter(Boolean)
          if (items.length) sections.push({ title: label, kind: 'list', items })
          continue
        }

        if (value && typeof value === 'object') {
          const nestedPairs = Object.entries(value as Record<string, unknown>)
            .map(([nestedKey, nestedValue]) => ({
              label: getPromptEffectSummaryLabel(nestedKey),
              value: getPromptEffectSummaryText(nestedValue),
            }))
            .filter((item) => item.value)
          if (nestedPairs.length) sections.push({ title: label, kind: 'pairs', pairs: nestedPairs })
          continue
        }

        const textValue = getPromptEffectSummaryText(value)
        if (textValue) pairs.push({ label, value: textValue })
      }

      if (pairs.length) sections.unshift({ title: '关键信息', kind: 'pairs', pairs })
      return { lead, sections }
    }
  } catch {}

  return { lead: text, sections: [] as Array<Record<string, any>> }
}

const promptEffectSummaryView = computed(() => parsePromptEffectSummary(promptEffectAssessmentResult?.value?.effectAssessment?.summary || ''))
</script>

<template>
  <div class="ui-toast-stack" v-if="uiToastQueue.length">
    <article class="component-toast-item ui-toast-item" v-for="item in uiToastQueue" :key="item.id" :data-tone="item.tone">
      <div class="component-toast-main">
        <span class="component-toast-icon">{{ item.tone.slice(0, 1).toUpperCase() }}</span>
        <div class="component-toast-text">
          <strong>{{ item.tone === 'success' ? '成功' : item.tone === 'danger' ? '失败' : item.tone === 'warning' ? '提醒' : '提示' }}</strong>
          <p>{{ item.text }}</p>
        </div>
      </div>
      <div class="component-toast-actions">
        <button type="button" class="app-btn-ghost component-toast-close-btn" @click="removeUiToast(item.id)">关闭</button>
      </div>
    </article>
  </div>

  <div class="import-modal-backdrop" v-if="importModalOpen" @click.self="closeImportModal">
    <section class="import-modal">
      <header class="import-modal-head">
        <h3>导入文件夹</h3>
        <button type="button" class="app-btn-ghost modal-close-btn" @click="closeImportModal" aria-label="关闭弹窗">×</button>
      </header>

      <input class="app-input" ref="folderInputRef" type="file" webkitdirectory directory multiple hidden @change="onFolderPicked" />

      <div class="stack">
        <small>已选文件夹：{{ importForm.sourceRoot || '未选择' }}</small>
        <small>AI 来源：{{ activeProviderLabel }}</small>
        <button type="button" class="app-btn-ghost" @click="triggerFolderSelect" :disabled="previewing || importing">
          {{ previewing ? '读取文件夹中...' : '选择文件夹' }}
        </button>

        <div class="import-modal-actions">
          <button type="button" class="app-btn-ghost" @click="resetImportSelection" :disabled="previewing || importing">
            重置
          </button>
          <button type="button" class="app-btn-ghost" @click="previewImport" :disabled="previewing || importing || !importFiles.length">
            {{ previewing ? '预览中...' : '导入预览' }}
          </button>
          <button class="app-btn"
            type="button"
            @click="importFolder"
            :disabled="importing || previewing || !importFiles.length"
          >
            {{ importing ? '导入中...' : '完成导入' }}
          </button>
        </div>
      </div>

      <div class="source-item" v-if="importPreview">
        <strong>导入预览</strong>
        <small>识别会话：{{ importPreview.count }} 条</small>
        <small>分类：{{ activeProviderLabel }}</small>
        <div class="preview-tags">
          <span v-for="(num, key) in importPreview.bySourceType" :key="key">{{ key }}: {{ num }}</span>
        </div>
        <div class="preview-list" v-if="importPreview.sample.length">
          <small v-for="item in importPreview.sample.slice(0, 8)" :key="item.id">
            {{ item.title }}（{{ item.messageCount }}）
          </small>
        </div>
      </div>
    </section>
  </div>

  <Dialog :open="quickCaptureOpen" @update:open="(open) => { if (!open) closeQuickCapture() }">
    <DialogContent class="component-modal-dialog component-modal-dialog--md component-modal-dialog--tone-info form-modal-dialog quick-capture-dialog" :show-close="false">
      <DialogHeader class="component-modal-dialog-header">
        <div class="component-modal-dialog-title-row">
          <div class="form-modal-title-wrap">
            <DialogTitle class="form-modal-title">快速采集</DialogTitle>
            <DialogDescription class="form-modal-desc">
              先把零散片段、主观判断或一份文档摘要收进系统，稍后再整理成更正式的知识页。
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭弹窗" :disabled="quickCaptureSaving">×</button>
          </DialogClose>
        </div>
      </DialogHeader>

      <div class="component-modal-dialog-body form-modal-body quick-capture-body">
        <div class="quick-capture-type-options">
          <button
            type="button"
            class="app-btn-ghost quick-capture-type-btn"
            :class="{ active: quickCaptureSourceType === 'capture' }"
            @click="quickCaptureSourceType = 'capture'"
          >
            <strong>Capture</strong>
            <small>原始片段</small>
          </button>
          <button
            type="button"
            class="app-btn-ghost quick-capture-type-btn"
            :class="{ active: quickCaptureSourceType === 'note' }"
            @click="quickCaptureSourceType = 'note'"
          >
            <strong>Note</strong>
            <small>人工判断</small>
          </button>
          <button
            type="button"
            class="app-btn-ghost quick-capture-type-btn"
            :class="{ active: quickCaptureSourceType === 'document' }"
            @click="quickCaptureSourceType = 'document'"
          >
            <strong>Document</strong>
            <small>长文素材</small>
          </button>
        </div>

        <div class="quick-capture-mode-options">
          <button
            type="button"
            class="app-btn-ghost quick-capture-mode-btn"
            :class="{ active: quickCaptureMode === 'single' }"
            @click="quickCaptureMode = 'single'"
          >
            单条采集
          </button>
          <button
            type="button"
            class="app-btn-ghost quick-capture-mode-btn"
            :class="{ active: quickCaptureMode === 'batch' }"
            @click="quickCaptureMode = 'batch'"
          >
            批量采集
          </button>
        </div>

        <div class="quick-capture-workspace">
          <section class="quick-capture-main">
            <label class="form-modal-field quick-capture-title-field">
              <small>{{ quickCaptureMode === 'batch' ? '标题前缀，可选' : '标题，可选' }}</small>
              <input class="app-input" v-model="quickCaptureTitle" type="text" placeholder="一句话概括这条内容" />
            </label>

            <label class="form-modal-field quick-capture-content-field">
              <small>{{ quickCaptureMode === 'batch' ? '批量内容' : '内容' }}</small>
              <textarea
                class="app-textarea quick-capture-textarea"
                v-model="quickCaptureContent"
                rows="8"
                :placeholder="quickCaptureMode === 'batch' ? '每条片段之间空一行，或用 --- 分隔' : '直接粘贴网页摘录、聊天片段、终端输出或你自己的想法'"
              />
            </label>
          </section>

          <aside class="quick-capture-aside">
            <div class="quick-capture-grid">
              <label class="form-modal-field">
                <small>来源链接，可选</small>
                <div class="knowledge-input-with-icon">
                  <IconLink2 :size="16" />
                  <input class="app-input" v-model="quickCaptureSourceUrl" type="text" placeholder="https://..." />
                </div>
              </label>

              <label class="form-modal-field">
                <small>标签，可选</small>
                <input class="app-input" v-model="quickCaptureTagsInput" type="text" placeholder="karpathy, wiki, workflow" />
              </label>

              <label class="form-modal-field">
                <small>项目 / 工作流</small>
                <input class="app-input" v-model="quickCaptureProject" type="text" placeholder="myLocalRAG / srs-h5" />
              </label>

              <label class="form-modal-field">
                <small>主题</small>
                <input class="app-input" v-model="quickCaptureTopic" type="text" placeholder="采集流程 / obsidian" />
              </label>

              <label class="form-modal-field">
                <small>下一步去向</small>
                <select class="app-select" v-model="quickCaptureIntakeStage">
                  <option value="inbox">Inbox</option>
                  <option value="needs-context">补上下文</option>
                  <option value="search-candidate">进主检索</option>
                  <option value="wiki-candidate">进 Wiki 编译</option>
                  <option value="reference-only">仅参考</option>
                </select>
              </label>

              <label class="form-modal-field">
                <small>可信度</small>
                <select class="app-select" v-model="quickCaptureConfidence">
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                </select>
              </label>
            </div>

            <label class="quick-capture-checkbox">
              <input type="checkbox" v-model="quickCaptureMarkActive" />
              <span>保存后直接标为 Active，作为后续 wiki 编译候选</span>
            </label>

            <label class="form-modal-field">
              <small>处理备注，可选</small>
              <textarea
                class="app-textarea quick-capture-note-textarea"
                v-model="quickCaptureDecisionNote"
                placeholder="为什么值得保留，或者还缺什么上下文"
              />
            </label>

            <article class="quick-capture-preview-card">
              <div class="quick-capture-preview-head">
                <IconSparkles :size="16" />
                <strong>预览</strong>
              </div>
              <p>{{ quickCaptureSummary || quickCapturePreview }}</p>
              <small v-if="quickCaptureMode === 'batch' && quickCaptureBatchEntries.length">
                第一条：{{ quickCaptureBatchEntries[0]?.title }}
              </small>
            </article>
          </aside>
        </div>
      </div>

      <footer class="component-modal-actions form-modal-actions">
        <button type="button" class="app-btn-ghost" @click="closeQuickCapture" :disabled="quickCaptureSaving">取消</button>
        <button type="button" class="app-btn" @click="saveQuickCapture" :disabled="quickCaptureSaving || !quickCaptureCanSave">
          {{ quickCaptureSaving ? '保存中...' : '保存并进入知识采集' }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="modelSettingsOpen" @update:open="(open) => { if (!open) closeModelSettings() }">
    <DialogContent class="component-modal-dialog component-modal-dialog--md component-modal-dialog--tone-info model-settings-dialog" :show-close="false">
      <DialogHeader class="component-modal-dialog-header model-settings-dialog-header">
        <div class="component-modal-dialog-title-row">
          <div class="model-settings-dialog-title-wrap">
            <DialogTitle class="model-settings-dialog-title">编辑模型配置</DialogTitle>
            <DialogDescription class="model-settings-dialog-desc">
              只展示当前选中模型的职责和配置项，避免把其他模型信息混在一起。
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button
              type="button"
              class="app-btn-ghost modal-close-btn"
              aria-label="关闭弹窗"
              :disabled="modelSettingsSaving"
            >×</button>
          </DialogClose>
        </div>
      </DialogHeader>

      <Separator class="model-settings-dialog-separator" />

      <div class="component-modal-dialog-body model-settings-dialog-body">
        <template v-if="selectedModelSettingsItem">
          <article class="model-editor-hero">
            <div class="model-editor-hero-badge">{{ selectedModelSettingsItem.avatarText }}</div>
            <div class="model-editor-hero-main">
              <div class="model-editor-hero-top">
                <div>
                  <p class="model-editor-eyebrow">当前模型</p>
                  <h3 class="model-editor-title">{{ selectedModelSettingsItem.title }}</h3>
                </div>
                <Badge :variant="selectedModelSettingsItem.enabled ? 'secondary' : 'outline'">
                  {{ selectedModelSettingsItem.enabled ? '已启用' : '待补全' }}
                </Badge>
              </div>
              <p class="model-editor-subtitle">{{ selectedModelSettingsItem.subtitle }}</p>
              <p class="model-editor-desc">{{ selectedModelSettingsItem.description }}</p>
              <div class="model-editor-role-list">
                <span
                  v-for="owner in selectedModelSettingsItem.owners"
                  :key="`${selectedModelSettingsItem.id}-${owner}`"
                  class="model-editor-role-chip"
                >
                  {{ owner }}
                </span>
              </div>
            </div>
          </article>

          <article class="model-editor-card">
            <header class="model-editor-card-head">
              <div>
                <p class="model-editor-card-kicker">职责范围</p>
                <h4 class="model-editor-card-title">当前模型承担的能力</h4>
              </div>
              <button
                type="button"
                class="app-btn-ghost model-editor-test-btn"
                @click="testSelectedModelSettings"
                :disabled="modelSettingsLoading || modelSettingsSaving || modelSettingsTesting"
              >
                {{ modelSettingsTesting ? '测试中...' : '测试连通性' }}
              </button>
            </header>
            <div class="model-editor-duty-list">
              <span
                v-for="duty in selectedModelSettingsItem.capabilityTitles"
                :key="`${selectedModelSettingsItem.id}-duty-${duty}`"
                class="model-editor-duty-chip"
              >
                {{ duty }}
              </span>
              <span
                v-for="path in selectedModelSettingsItem.paths"
                :key="`${selectedModelSettingsItem.id}-path-${path}`"
                class="model-editor-path-chip"
              >
                {{ path }}
              </span>
            </div>
            <div v-if="modelSettingsTestResults.length" class="model-editor-test-results">
              <div
                v-for="item in modelSettingsTestResults"
                :key="`${item.owner}-${item.model}`"
                class="model-editor-test-item"
                :data-ok="item.ok ? 'true' : 'false'"
              >
                <div class="model-editor-test-item-top">
                  <strong>{{ item.owner }}</strong>
                  <Badge :variant="item.ok ? 'secondary' : 'outline'">
                    {{ item.ok ? '通过' : '失败' }}
                  </Badge>
                </div>
                <p>{{ item.detail }}</p>
              </div>
            </div>
          </article>

          <article v-if="selectedModelSettingsItem.ownerKeys.includes('assistant')" class="model-editor-section" data-owner="assistant">
            <header class="model-editor-section-head">
              <div>
                <p class="model-editor-section-kicker">Assistant</p>
                <h4 class="model-editor-section-title">生成职责配置</h4>
              </div>
              <span class="model-editor-section-badge">/api/ask</span>
            </header>
            <div class="model-settings-grid">
              <div class="model-settings-field-stack">
                <label class="model-settings-field">
                  <span class="model-settings-field-label">API Base</span>
                  <input class="app-input" v-model="modelSettingsDraft.assistant.apiBase" type="text" placeholder="例如 https://your-gateway/v1" />
                </label>
                <label class="model-settings-field">
                  <span class="model-settings-field-label">API Key</span>
                  <input class="app-input" v-model="modelSettingsDraft.assistant.apiKey" type="password" placeholder="输入 Assistant API Key" />
                </label>
                <label class="model-settings-field">
                  <span class="model-settings-field-label">模型名</span>
                  <input class="app-input" v-model="modelSettingsDraft.assistant.model" type="text" placeholder="例如 gpt-4.1-mini" />
                </label>
                <label class="model-settings-field">
                  <span class="model-settings-field-label">截止日期</span>
                  <input class="app-input" v-model="modelSettingsDraft.assistant.dueDate" type="date" />
                </label>
              </div>
              <div class="model-settings-metric-grid">
                <label class="model-settings-field">
                  <span class="model-settings-field-label">超时</span>
                  <input class="app-input" v-model.number="modelSettingsDraft.assistant.timeoutMs" type="number" min="3000" step="1000" placeholder="60000" />
                </label>
                <label class="model-settings-field">
                  <span class="model-settings-field-label">Temperature</span>
                  <input class="app-input" v-model.number="modelSettingsDraft.assistant.temperature" type="number" min="0" max="2" step="0.1" placeholder="0.2" />
                </label>
                <label class="model-settings-field">
                  <span class="model-settings-field-label">Top P</span>
                  <input class="app-input" v-model.number="modelSettingsDraft.assistant.topP" type="number" min="0" max="1" step="0.1" placeholder="1" />
                </label>
                <label class="model-settings-field">
                  <span class="model-settings-field-label">Max Tokens</span>
                  <input class="app-input" v-model.number="modelSettingsDraft.assistant.maxTokens" type="number" min="0" step="256" placeholder="0 表示默认" />
                </label>
              </div>
            </div>
          </article>

          <article v-if="selectedModelSettingsItem.ownerKeys.includes('embedding')" class="model-editor-section" data-owner="embedding">
            <header class="model-editor-section-head">
              <div>
                <p class="model-editor-section-kicker">Embedding</p>
                <h4 class="model-editor-section-title">向量职责配置</h4>
              </div>
              <span class="model-editor-section-badge">检索 / 构建</span>
            </header>
            <div class="model-settings-grid">
              <div class="model-settings-field-stack">
                <label class="model-settings-field">
                  <span class="model-settings-field-label">API Base</span>
                  <input class="app-input" v-model="modelSettingsDraft.embedding.apiBase" type="text" placeholder="Embedding API Base" />
                </label>
                <label class="model-settings-field">
                  <span class="model-settings-field-label">API Key</span>
                  <input class="app-input" v-model="modelSettingsDraft.embedding.apiKey" type="password" placeholder="Embedding API Key" />
                </label>
                <label class="model-settings-field">
                  <span class="model-settings-field-label">模型名</span>
                  <input class="app-input" v-model="modelSettingsDraft.embedding.model" type="text" placeholder="Embedding 模型名" />
                </label>
                <label class="model-settings-field">
                  <span class="model-settings-field-label">截止日期</span>
                  <input class="app-input" v-model="modelSettingsDraft.embedding.dueDate" type="date" />
                </label>
              </div>
              <div class="model-settings-metric-grid model-settings-metric-grid--compact">
                <label class="model-settings-field">
                  <span class="model-settings-field-label">超时</span>
                  <input class="app-input" v-model.number="modelSettingsDraft.embedding.timeoutMs" type="number" min="3000" step="1000" placeholder="20000" />
                </label>
                <label class="model-settings-field">
                  <span class="model-settings-field-label">维度</span>
                  <input class="app-input" v-model.number="modelSettingsDraft.embedding.dimensions" type="number" min="0" step="1" placeholder="1024" />
                </label>
                <label class="model-settings-field">
                  <span class="model-settings-field-label">批大小</span>
                  <input class="app-input" v-model.number="modelSettingsDraft.embedding.maxBatch" type="number" min="1" max="64" step="1" placeholder="5" />
                </label>
              </div>
            </div>
          </article>

          <article v-if="selectedModelSettingsItem.ownerKeys.includes('dspy')" class="model-editor-section" data-owner="dspy">
            <header class="model-editor-section-head">
              <div>
                <p class="model-editor-section-kicker">DSPy</p>
                <h4 class="model-editor-section-title">优化职责配置</h4>
              </div>
              <span class="model-editor-section-badge">/api/prompt-optimize</span>
            </header>
            <div class="model-settings-grid">
              <label class="model-settings-checkbox">
                <input v-model="modelSettingsDraft.dspy.inheritFromAssistant" type="checkbox" />
                <span>沿用 Assistant 模型配置</span>
              </label>
              <div class="model-settings-metric-grid model-settings-metric-grid--compact">
                <label class="model-settings-field">
                  <span class="model-settings-field-label">Provider</span>
                  <input class="app-input" v-model="modelSettingsDraft.dspy.provider" type="text" placeholder="例如 openai" />
                </label>
                <label class="model-settings-field">
                  <span class="model-settings-field-label">超时</span>
                  <input class="app-input" v-model.number="modelSettingsDraft.dspy.timeoutMs" type="number" min="10000" step="1000" placeholder="90000" />
                </label>
                <label class="model-settings-field">
                  <span class="model-settings-field-label">截止日期</span>
                  <input class="app-input" v-model="modelSettingsDraft.dspy.dueDate" type="date" />
                </label>
              </div>
              <template v-if="!modelSettingsDraft.dspy.inheritFromAssistant">
                <div class="model-settings-field-stack">
                  <label class="model-settings-field">
                    <span class="model-settings-field-label">API Base</span>
                    <input class="app-input" v-model="modelSettingsDraft.dspy.apiBase" type="text" placeholder="DSPy API Base" />
                  </label>
                  <label class="model-settings-field">
                    <span class="model-settings-field-label">API Key</span>
                    <input class="app-input" v-model="modelSettingsDraft.dspy.apiKey" type="password" placeholder="DSPy API Key" />
                  </label>
                  <label class="model-settings-field">
                    <span class="model-settings-field-label">模型名</span>
                    <input class="app-input" v-model="modelSettingsDraft.dspy.model" type="text" placeholder="DSPy 模型名" />
                  </label>
                </div>
              </template>
            </div>
          </article>
        </template>

        <div v-else class="model-editor-empty">
          还没有选中的模型，先从“模型管理”列表里点击一条模型卡再进入编辑。
        </div>
      </div>

      <footer class="component-modal-actions model-settings-actions">
        <button type="button" class="app-btn-ghost" @click="resetModelSettingsDraft" :disabled="modelSettingsSaving">重置草稿</button>
        <button type="button" class="app-btn-ghost" @click="closeModelSettings" :disabled="modelSettingsSaving">取消</button>
        <button type="button" class="app-btn" @click="saveModelSettings" :disabled="modelSettingsLoading || modelSettingsSaving">
          {{ modelSettingsSaving ? '保存中...' : '保存配置' }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="feishuProjectSettingsOpen" @update:open="(open) => { if (!open) closeFeishuProjectSettings() }">
    <DialogContent class="component-modal-dialog component-modal-dialog--md component-modal-dialog--tone-info feishu-settings-dialog" :show-close="false">
      <DialogHeader class="component-modal-dialog-header feishu-settings-dialog-header">
        <div class="component-modal-dialog-title-row">
          <div class="form-modal-title-wrap">
            <DialogTitle class="form-modal-title">飞书账号切换</DialogTitle>
            <DialogDescription class="form-modal-desc">
              当前生效配置：{{ feishuProjectSettingsModeLabel }}。保存后会立刻用新的 X-Mcp-Token 刷新飞书数据。
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button
              type="button"
              class="app-btn-ghost modal-close-btn"
              aria-label="关闭弹窗"
              :disabled="feishuProjectSettingsSaving"
            >×</button>
          </DialogClose>
        </div>
      </DialogHeader>

      <div class="component-modal-dialog-body form-modal-body feishu-settings-body">
        <p class="warn" v-if="feishuProjectSettingsLoading">配置加载中...</p>
        <template v-else>
          <div class="feishu-settings-meta">
            <span class="model-editor-role-chip">当前模式：{{ feishuProjectSettings.effectiveConfig.mode === 'custom' ? '自定义 Token' : '默认配置' }}</span>
            <span class="model-editor-path-chip">Project Key：{{ feishuProjectSettings.effectiveConfig.projectKey || '-' }}</span>
            <span class="model-editor-duty-chip">
              Token：{{ feishuProjectSettings.effectiveConfig.tokenMasked || (feishuProjectSettings.effectiveConfig.tokenAvailable ? '已配置' : '未配置') }}
            </span>
          </div>

          <div class="feishu-settings-option-list" role="radiogroup" aria-label="飞书账号配置来源">
            <label class="feishu-settings-option" :class="{ selected: feishuProjectSettingsDraft.mode === 'default' }">
              <input v-model="feishuProjectSettingsDraft.mode" type="radio" class="feishu-settings-radio" value="default" />
              <div class="feishu-settings-option-main">
                <div class="feishu-settings-option-top">
                  <strong>默认配置</strong>
                  <span class="component-list-status" :data-tone="feishuProjectSettings.defaultConfig.tokenAvailable ? 'success' : 'danger'">
                    {{ feishuProjectSettings.defaultConfig.tokenAvailable ? '可用' : '缺少 Token' }}
                  </span>
                </div>
                <p>沿用 `.env` 里的飞书 MCP 配置，适合作为团队默认账号。</p>
                <small>MCP URL：{{ feishuProjectSettings.defaultConfig.mcpUrl || '-' }}</small>
                <small>Project Key：{{ feishuProjectSettings.defaultConfig.projectKey || '-' }}</small>
                <small>Token：{{ feishuProjectSettings.defaultConfig.tokenMasked || '未配置' }}</small>
              </div>
            </label>

            <label class="feishu-settings-option" :class="{ selected: feishuProjectSettingsDraft.mode === 'custom' }">
              <input v-model="feishuProjectSettingsDraft.mode" type="radio" class="feishu-settings-radio" value="custom" />
              <div class="feishu-settings-option-main">
                <div class="feishu-settings-option-top">
                  <strong>自定义 Token</strong>
                  <span class="component-list-status" :data-tone="feishuProjectSettings.customConfig.tokenAvailable ? 'warning' : 'muted'">
                    {{ feishuProjectSettings.customConfig.tokenAvailable ? '已保存自定义 Token' : '未保存' }}
                  </span>
                </div>
                <p>粘贴新的 `X-Mcp-Token`，即可切换到另一个飞书 MCP 账号视角。</p>
                <label class="form-modal-field">
                  <small>X-Mcp-Token</small>
                  <input
                    class="app-input"
                    v-model="feishuProjectSettingsDraft.customConfig.token"
                    type="password"
                    placeholder="粘贴飞书 X-Mcp-Token"
                    :disabled="feishuProjectSettingsSaving"
                  />
                </label>
                <small v-if="feishuProjectSettings.customConfig.tokenAvailable && !feishuProjectSettingsDraft.customConfig.token">
                  已保存 Token：{{ feishuProjectSettings.customConfig.tokenMasked }}。留空则继续沿用。
                </small>
                <label class="form-modal-field">
                  <small>Project Key（可选）</small>
                  <input
                    class="app-input"
                    v-model="feishuProjectSettingsDraft.customConfig.projectKey"
                    type="text"
                    placeholder="留空则沿用默认 Project Key"
                    :disabled="feishuProjectSettingsSaving"
                  />
                </label>
              </div>
            </label>
          </div>

          <p class="error" v-if="feishuProjectSettingsError">{{ feishuProjectSettingsError }}</p>
        </template>
      </div>

      <footer class="component-modal-actions form-modal-actions">
        <button type="button" class="app-btn-ghost" @click="resetFeishuProjectSettingsDraft" :disabled="feishuProjectSettingsSaving">重置草稿</button>
        <button type="button" class="app-btn-ghost" @click="closeFeishuProjectSettings" :disabled="feishuProjectSettingsSaving">取消</button>
        <button
          type="button"
          class="app-btn"
          @click="saveFeishuProjectSettings"
          :disabled="feishuProjectSettingsLoading || feishuProjectSettingsSaving"
        >
          {{ feishuProjectSettingsSaving ? '保存中...' : '保存并切换' }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="embeddingBuildModalOpen" @update:open="(open) => { if (!open) closeEmbeddingBuildModal() }">
    <DialogContent class="component-modal-dialog component-modal-dialog--tone-info embedding-build-dialog" :show-close="false">
      <DialogHeader class="component-modal-dialog-header embedding-build-dialog-header">
        <div class="component-modal-dialog-title-row">
          <div class="embedding-build-dialog-title-wrap">
            <DialogTitle class="embedding-build-dialog-title">手动构建向量</DialogTitle>
            <DialogDescription class="embedding-build-dialog-desc">按当前会话来源重建 embedding，支持 local / remote 两种模式。</DialogDescription>
          </div>
          <DialogClose as-child>
            <button
              type="button"
              class="app-btn-ghost modal-close-btn"
              aria-label="关闭弹窗"
              :disabled="rebuildingEmbeddings"
            >×</button>
          </DialogClose>
        </div>
      </DialogHeader>
      <Separator class="embedding-build-dialog-separator" />

      <div class="component-modal-dialog-body embedding-build-body">
        <div class="embedding-build-stats bug-detail-field-list">
          <small v-if="embeddingBuildStatsLoading">统计加载中...</small>
          <template v-else>
            <article class="bug-detail-field-item">
              <div class="bug-detail-field-label-row">
                <p class="bug-detail-field-label">当前总条数</p>
              </div>
              <div class="bug-detail-field-box">
                <p class="bug-detail-value-text">{{ Number(embeddingBuildStats?.totalSessions || 0) }}</p>
              </div>
            </article>
            <article class="bug-detail-field-item">
              <div class="bug-detail-field-label-row">
                <p class="bug-detail-field-label">当前 chunk 总数</p>
              </div>
              <div class="bug-detail-field-box">
                <p class="bug-detail-value-text">{{ Number(embeddingBuildStats?.totalChunks || 0) }}</p>
              </div>
            </article>
            <article class="bug-detail-field-item">
              <div class="bug-detail-field-label-row">
                <p class="bug-detail-field-label">上次构建时间</p>
              </div>
              <div class="bug-detail-field-box">
                <p class="bug-detail-value-datetime">{{ embeddingBuildStats?.lastBuildAt ? formatTime(embeddingBuildStats.lastBuildAt) : '暂无' }}</p>
              </div>
            </article>
            <article class="bug-detail-field-item">
              <div class="bug-detail-field-label-row">
                <p class="bug-detail-field-label">上次构建条数</p>
              </div>
              <div class="bug-detail-field-box">
                <p class="bug-detail-value-text">{{ Number(embeddingBuildStats?.lastBuildGenerated || 0) }}</p>
              </div>
            </article>
          </template>
        </div>

        <article class="embedding-build-form embedding-build-form--compact bug-detail-field-item">
          <div class="bug-detail-field-label-row">
            <p class="bug-detail-field-label">Embed 方式</p>
          </div>
          <div class="bug-detail-field-box embedding-build-mode-box">
            <select class="app-select" v-model="embeddingBuildMode" :disabled="rebuildingEmbeddings" @change="loadEmbeddingBuildPreview">
              <option value="local">local</option>
              <option value="remote">remote</option>
            </select>
            <small>手动构建默认只处理新增或变化的 chunk，不再重复全量重建。</small>
          </div>
        </article>

        <article class="embedding-build-form embedding-build-form--expanded bug-detail-field-item">
          <div class="bug-detail-field-label-row">
            <p class="bug-detail-field-label">本次预估</p>
          </div>
          <div class="bug-detail-field-box embedding-build-plan-box">
            <small v-if="embeddingBuildPreviewLoading">正在计算待构建数量...</small>
            <template v-else-if="embeddingBuildPreview">
              <div class="embedding-build-plan-summary">
                <strong>即将处理 {{ Number(embeddingBuildPreview.targetCount || 0) }} 条 chunk</strong>
                <span>当前模式：{{ embeddingBuildPreview.embedMode }}</span>
              </div>
              <div class="embedding-build-plan-chips">
                <span>缺失 {{ Number(embeddingBuildPreview.reasonCounts?.missing || 0) }}</span>
                <span>内容变化 {{ Number(embeddingBuildPreview.reasonCounts?.changed || 0) }}</span>
                <span>模型切换 {{ Number((embeddingBuildPreview.reasonCounts?.model_mismatch || 0) + (embeddingBuildPreview.reasonCounts?.dims_mismatch || 0)) }}</span>
                <span>过期 {{ Number(embeddingBuildPreview.reasonCounts?.stale || 0) }}</span>
              </div>
              <small>
                来源 {{ embeddingBuildPreview.embedding?.source || '-' }}，模型 {{ embeddingBuildPreview.embedding?.model || '-' }}
                <template v-if="embeddingBuildMode === 'remote'">，远程模式遇到限流会自动重试并显示进度</template>
              </small>
            </template>
            <small v-else>暂无预估数据</small>
          </div>
        </article>

        <article class="embedding-build-form embedding-build-form--expanded bug-detail-field-item" v-if="embeddingBuildJob">
          <div class="bug-detail-field-label-row">
            <p class="bug-detail-field-label">构建进度</p>
          </div>
          <div class="bug-detail-field-box embedding-build-progress-box">
            <div class="embedding-build-progress-head">
              <strong>{{ Math.round(Number(embeddingBuildJob.progress || 0) * 100) }}%</strong>
              <span>{{ embeddingBuildJob.statusText || (rebuildingEmbeddings ? '构建中...' : '等待开始') }}</span>
            </div>
            <div class="embedding-build-progress-track">
              <span class="embedding-build-progress-fill" :style="{ width: `${Math.max(0, Math.min(100, Math.round(Number(embeddingBuildJob.progress || 0) * 100)))}%` }" />
            </div>
            <div class="embedding-build-plan-chips">
              <span>已处理 {{ Number(embeddingBuildJob.processed || 0) }}/{{ Number(embeddingBuildJob.targetCount || 0) }}</span>
              <span>已生成 {{ Number(embeddingBuildJob.generated || 0) }}</span>
              <span v-if="Number(embeddingBuildJob.failed || 0) > 0">失败 {{ Number(embeddingBuildJob.failed || 0) }}</span>
              <span v-if="Number(embeddingBuildJob.retryCount || 0) > 0">重试 {{ Number(embeddingBuildJob.retryCount || 0) }}</span>
            </div>
            <small v-if="embeddingBuildJob.lastRetryError">
              最近一次重试：{{ embeddingBuildJob.lastRetryError }}
            </small>
          </div>
        </article>
      </div>

      <footer class="component-modal-actions embedding-build-actions">
        <button type="button" class="app-btn-ghost" @click="closeEmbeddingBuildModal" :disabled="rebuildingEmbeddings">取消</button>
        <button
          type="button"
          class="app-btn"
          @click="rebuildSessionEmbeddings"
          :disabled="rebuildingEmbeddings || embeddingBuildPreviewLoading || Number(embeddingBuildPreview?.targetCount || 0) <= 0"
        >
          {{ rebuildingEmbeddings ? '构建中...' : `开始构建（${Number(embeddingBuildPreview?.targetCount || 0)}）` }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="wikiVaultSyncModalOpen" @update:open="(open) => { if (!open) closeWikiVaultSyncModal() }">
    <DialogContent class="component-modal-dialog component-modal-dialog--tone-info embedding-build-dialog wiki-vault-sync-dialog" :show-close="false">
      <DialogHeader class="component-modal-dialog-header embedding-build-dialog-header">
        <div class="component-modal-dialog-title-row">
          <div class="embedding-build-dialog-title-wrap">
            <DialogTitle class="embedding-build-dialog-title">同步到 Obsidian</DialogTitle>
            <DialogDescription class="embedding-build-dialog-desc">
              先确认同步方式、工作量和预计模型消耗，再把 source / concept 页面发布到 Vault。
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button
              type="button"
              class="app-btn-ghost modal-close-btn"
              aria-label="关闭弹窗"
              :disabled="syncingWikiVault"
            >×</button>
          </DialogClose>
        </div>
      </DialogHeader>
      <Separator class="embedding-build-dialog-separator" />

      <div class="component-modal-dialog-body embedding-build-body">
        <div class="embedding-build-stats bug-detail-field-list">
          <small v-if="wikiVaultSyncStatsLoading">统计加载中...</small>
          <template v-else>
            <article class="bug-detail-field-item">
              <div class="bug-detail-field-label-row">
                <p class="bug-detail-field-label">同步范围</p>
              </div>
              <div class="bug-detail-field-box">
                <p class="bug-detail-value-text">{{ wikiVaultProviderLabel }}</p>
              </div>
            </article>
            <article class="bug-detail-field-item">
              <div class="bug-detail-field-label-row">
                <p class="bug-detail-field-label">当前 source 总数</p>
              </div>
              <div class="bug-detail-field-box">
                <p class="bug-detail-value-text">{{ Number(wikiVaultSyncStats?.currentSessions || 0) }}</p>
              </div>
            </article>
            <article class="bug-detail-field-item">
              <div class="bug-detail-field-label-row">
                <p class="bug-detail-field-label">当前 concept 总数</p>
              </div>
              <div class="bug-detail-field-box">
                <p class="bug-detail-value-text">{{ Number(wikiVaultSyncStats?.currentConcepts || 0) }}</p>
              </div>
            </article>
            <article class="bug-detail-field-item">
              <div class="bug-detail-field-label-row">
                <p class="bug-detail-field-label">上次同步时间</p>
              </div>
              <div class="bug-detail-field-box">
                <p class="bug-detail-value-datetime">{{ wikiVaultSyncStats?.generatedAt ? formatTime(wikiVaultSyncStats.generatedAt) : '暂无' }}</p>
              </div>
            </article>
          </template>
        </div>

        <article class="embedding-build-form embedding-build-form--expanded bug-detail-field-item">
          <div class="bug-detail-field-label-row">
            <p class="bug-detail-field-label">同步方式</p>
          </div>
          <div class="bug-detail-field-box embedding-build-plan-box wiki-vault-mode-box">
            <select class="app-select" v-model="wikiVaultSyncMode" :disabled="syncingWikiVault" @change="loadWikiVaultSyncPreview">
              <option value="publish-only">快速发布（仅发布 source / fallback concept）</option>
              <option value="publish-with-summary">深度汇总（允许调用模型生成 concept 摘要）</option>
            </select>
            <div class="embedding-build-plan-chips">
              <span>上次模式 {{ wikiVaultSyncStats?.syncMode === 'publish-with-summary' ? '深度汇总' : '快速发布' }}</span>
              <span>上次发布 {{ Number(wikiVaultSyncStats?.publishedCount || 0) }} 条</span>
              <span>上次 LLM 汇总 {{ Number(wikiVaultSyncStats?.llmConceptCount || 0) }} 个</span>
            </div>
            <small v-if="wikiVaultSyncMode === 'publish-with-summary'">
              会尝试调用当前 Assistant 模型，为多来源 concept 生成可追溯的汇总页，可能产生 token 成本。
            </small>
            <small v-else>
              只做本地发布和规则兜底，不调用模型，适合日常快速同步。
            </small>
          </div>
        </article>

        <article class="embedding-build-form embedding-build-form--expanded bug-detail-field-item">
          <div class="bug-detail-field-label-row">
            <p class="bug-detail-field-label">本次预估</p>
          </div>
          <div class="bug-detail-field-box embedding-build-plan-box">
            <small v-if="wikiVaultSyncPreviewLoading">正在计算同步规模...</small>
            <template v-else-if="wikiVaultSyncPreview">
              <div class="embedding-build-plan-summary">
                <strong>即将发布 {{ Number(wikiVaultSyncPreview.totalSessions || 0) }} 条 source，实际刷新 {{ Number(wikiVaultSyncPreview.targetConcepts || 0) }} 个 concept</strong>
                <span>{{ wikiVaultSyncMode === 'publish-with-summary' ? '深度汇总' : '快速发布' }}</span>
              </div>
              <div class="embedding-build-plan-chips">
                <span>总步骤 {{ Number(wikiVaultSyncPreview.estimatedSteps || 0) }}</span>
                <span>具备跨来源条件 {{ Number(wikiVaultSyncPreview.llmEligibleConcepts || 0) }}</span>
                <span>预计模型调用 {{ Number(wikiVaultSyncPreview.estimatedModelCalls || 0) }}</span>
                <span v-if="Number(wikiVaultSyncPreview.reusableLlmConcepts || 0) > 0">复用已有 LLM {{ Number(wikiVaultSyncPreview.reusableLlmConcepts || 0) }}</span>
              </div>
              <small>
                <template v-if="wikiVaultSyncMode === 'publish-with-summary'">
                  只有跨 2 条及以上来源、且本次内容有变化的 concept 才会真正调用模型；已有 LLM 汇总且输入未变的页面会直接复用。
                </template>
                <template v-else>
                  本次只刷新 source 页和 concept 结构，不做模型摘要。
                </template>
              </small>
            </template>
            <small v-else>暂无预估数据</small>
          </div>
        </article>

        <article class="embedding-build-form embedding-build-form--expanded bug-detail-field-item" v-if="wikiVaultSyncJob">
          <div class="bug-detail-field-label-row">
            <p class="bug-detail-field-label">同步进度</p>
          </div>
          <div class="bug-detail-field-box embedding-build-progress-box">
            <div class="embedding-build-progress-head">
              <strong>{{ Math.round(Number(wikiVaultSyncJob.progress || 0) * 100) }}%</strong>
              <span>{{ wikiVaultSyncJob.statusText || (syncingWikiVault ? '同步中...' : '等待开始') }}</span>
            </div>
            <div class="embedding-build-progress-track">
              <span class="embedding-build-progress-fill" :style="{ width: `${Math.max(0, Math.min(100, Math.round(Number(wikiVaultSyncJob.progress || 0) * 100)))}%` }" />
            </div>
            <div class="embedding-build-plan-chips">
              <span>已处理 {{ Number(wikiVaultSyncJob.processedSteps || 0) }}/{{ Number(wikiVaultSyncJob.totalSteps || 0) }}</span>
              <span>已发布 {{ Number(wikiVaultSyncJob.publishedCount || 0) }}</span>
              <span>LLM 汇总 {{ Number(wikiVaultSyncJob.llmConceptCount || 0) }}</span>
              <span v-if="Number(wikiVaultSyncJob.reusedLlmConceptCount || 0) > 0">复用 LLM {{ Number(wikiVaultSyncJob.reusedLlmConceptCount || 0) }}</span>
              <span v-if="Number(wikiVaultSyncJob.fallbackConceptCount || 0) > 0">fallback {{ Number(wikiVaultSyncJob.fallbackConceptCount || 0) }}</span>
            </div>
            <small v-if="wikiVaultSyncJob.lastRun?.generatedAt">
              最近完成：{{ formatTime(wikiVaultSyncJob.lastRun.generatedAt) }}
            </small>
          </div>
        </article>
      </div>

      <footer class="component-modal-actions embedding-build-actions">
        <button type="button" class="app-btn-ghost" @click="closeWikiVaultSyncModal" :disabled="syncingWikiVault">取消</button>
        <button
          type="button"
          class="app-btn"
          @click="startWikiVaultSync"
          :disabled="!wikiVaultCanStart"
        >
          {{ syncingWikiVault ? '同步中...' : `开始同步（${Number(wikiVaultSyncPreview?.estimatedSteps || 0)} 步）` }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="patchDirSettingsOpen" @update:open="(open) => { if (!open) closePatchDirSettings() }">
    <DialogContent class="component-modal-dialog component-modal-dialog--md component-modal-dialog--tone-info patch-settings-dialog" :show-close="false">
      <DialogHeader class="component-modal-dialog-header patch-settings-dialog-header">
        <div class="component-modal-dialog-title-row">
          <div class="patch-settings-dialog-title-wrap">
            <DialogTitle class="patch-settings-dialog-title">Patch 路径设置</DialogTitle>
            <DialogDescription class="patch-settings-dialog-desc">
              维护 `.ai-patches` 路径字典，Bug Trace 下拉将使用这些配置。
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭弹窗" :disabled="patchDirAdding">×</button>
          </DialogClose>
        </div>
      </DialogHeader>

      <Separator class="patch-settings-dialog-separator" />

      <div class="component-modal-dialog-body patch-settings-dialog-body">
        <div class="patch-settings-meta">
          <small>当前总 patch 量：{{ patchDirTotal ?? '-' }}</small>
          <small v-if="selectedPatchDirPreset?.path">当前 patch 源：{{ selectedPatchDirPreset.path }}</small>
        </div>

        <div class="patch-settings-form">
          <input
            class="app-input"
            v-model="patchDirDraftAlias"
            type="text"
            placeholder="别名（如 srs-pc）"
            :disabled="patchDirAdding"
            @keyup.enter="addPatchDirPreset"
          />
          <input
            class="app-input"
            v-model="patchDirDraftPath"
            type="text"
            placeholder="绝对路径（如 /Users/xx/work/srs-pc/.ai-patches）"
            :disabled="patchDirAdding || !!patchDirEditingPresetId"
            @keyup.enter="addPatchDirPreset"
          />
          <div class="patch-settings-form-actions">
            <button class="app-btn" type="button" @click="addPatchDirPreset" :disabled="patchDirAdding">
              {{
                patchDirAdding
                  ? (patchDirEditingPresetId ? '保存中...' : '新增中...')
                  : (patchDirEditingPresetId ? '保存别名' : '新增')
              }}
            </button>
            <button
              v-if="patchDirEditingPresetId"
              type="button"
              class="app-btn-ghost"
              @click="cancelEditPatchDirPreset"
              :disabled="patchDirAdding"
            >
              取消编辑
            </button>
          </div>
        </div>

        <p v-if="editingPatchDirPreset" class="hint">
          正在编辑：`{{ editingPatchDirPreset.path }}` 的别名
        </p>

        <div class="patch-settings-list" v-if="patchDirPresets.length">
          <article class="patch-settings-item" v-for="item in patchDirPresets" :key="item.id" :class="{ selected: selectedPatchDirPresetId === item.id }">
            <div class="patch-settings-item-main">
              <strong>{{ item.alias }}</strong>
              <small>{{ item.path }}</small>
            </div>
            <div class="patch-settings-item-actions">
              <button type="button" class="app-btn-ghost" @click="selectedPatchDirPresetId = item.id" :disabled="patchDirAdding">选择</button>
              <button type="button" class="app-btn-ghost" @click="startEditPatchDirPreset(item)" :disabled="patchDirAdding">编辑别名</button>
              <button type="button" class="app-btn-ghost" @click="removePatchDirPreset(item.id)" :disabled="patchDirAdding">删除</button>
            </div>
          </article>
        </div>
      </div>

      <footer class="component-modal-actions patch-settings-actions">
        <button type="button" class="app-btn-ghost" @click="closePatchDirSettings" :disabled="patchDirAdding">关闭</button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="deleteConfirmOpen" @update:open="(open) => { if (!open) closeDeleteConfirm() }">
    <DialogContent class="component-confirm-dialog component-confirm-dialog--compact component-confirm-dialog--tone-danger" :show-close="false">
      <div class="component-confirm-head">
        <h4>确认删除当前会话？</h4>
        <span class="component-confirm-tone" data-tone="danger">danger</span>
      </div>
      <p class="component-confirm-desc">删除后将无法恢复，请确认是否删除当前会话。</p>
      <p class="confirm-title" v-if="pendingDeleteSession">「{{ getSessionDisplayTitle(pendingDeleteSession) }}」</p>
      <footer class="component-confirm-actions">
        <button type="button" class="app-btn-ghost" @click="closeDeleteConfirm" :disabled="!!deletingSessionId">取消</button>
        <button class="app-btn" type="button" @click="confirmDeleteSession" :disabled="!!deletingSessionId">
          {{ deletingSessionId ? '删除中...' : '确认删除' }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="bugInboxDeleteConfirmOpen" @update:open="(open) => { if (!open) closeBugInboxDeleteConfirm() }">
    <DialogContent class="component-confirm-dialog component-confirm-dialog--compact component-confirm-dialog--tone-danger" :show-close="false">
      <div class="component-confirm-head">
        <h4>确认删除这条记录？</h4>
        <span class="component-confirm-tone" data-tone="danger">danger</span>
      </div>
      <p class="component-confirm-desc">删除后将无法恢复，请确认是否删除该记录。</p>
      <p class="confirm-title" v-if="bugInboxPendingDelete">「{{ bugInboxPendingDelete.title || bugInboxPendingDelete.patchFile || '未命名 Bug' }}」</p>
      <footer class="component-confirm-actions">
        <button type="button" class="app-btn-ghost" @click="closeBugInboxDeleteConfirm" :disabled="!!bugInboxDeletingId">取消</button>
        <button class="app-btn" type="button" @click="confirmDeleteBugInbox" :disabled="!!bugInboxDeletingId">
          {{ bugInboxDeletingId ? '删除中...' : '确认删除' }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="feishuBatchModalOpen" @update:open="(open) => { if (!open) closeFeishuBatchModal() }">
    <DialogContent class="component-modal-dialog component-modal-dialog--md component-modal-dialog--tone-info form-modal-dialog" :show-close="false">
      <DialogHeader class="component-modal-dialog-header">
        <div class="component-modal-dialog-title-row">
          <div class="form-modal-title-wrap">
            <DialogTitle class="form-modal-title">批量处理排期待办</DialogTitle>
            <DialogDescription class="form-modal-desc">已选择 {{ selectedFeishuTodos.length }} 条待办，确认本次批处理动作。</DialogDescription>
          </div>
          <DialogClose as-child>
            <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭弹窗" :disabled="feishuBatchLoading">×</button>
          </DialogClose>
        </div>
      </DialogHeader>
      <div class="component-modal-dialog-body form-modal-body">
        <div class="stack">
          <label class="form-modal-field">
            <small>处理动作</small>
            <select class="app-select" v-model="feishuBatchAction" :disabled="feishuBatchLoading">
              <option value="confirm">流转完成（confirm）</option>
              <option value="rollback">回滚（rollback）</option>
            </select>
          </label>
          <label class="form-modal-field" v-if="feishuBatchAction === 'rollback'">
            <small>回滚原因（必填）</small>
            <textarea class="app-textarea"
              v-model="feishuBatchRollbackReason"
              rows="3"
              placeholder="请输入回滚原因"
              :disabled="feishuBatchLoading"
            />
          </label>
        </div>
        <p class="error" v-if="feishuBatchError">{{ feishuBatchError }}</p>
        <p class="hint" v-if="feishuBatchResultText">{{ feishuBatchResultText }}</p>
      </div>
      <footer class="component-modal-actions form-modal-actions">
        <button type="button" class="app-btn-ghost" @click="closeFeishuBatchModal" :disabled="feishuBatchLoading">取消</button>
        <button type="button" class="app-btn-danger" @click="submitFeishuBatchTransition" :disabled="feishuBatchLoading">
          {{ feishuBatchLoading ? '处理中...' : '确认批量处理' }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="tagModalOpen" @update:open="(open) => { if (!open) closeTagModal() }">
    <DialogContent class="component-modal-dialog component-modal-dialog--md component-modal-dialog--tone-info form-modal-dialog" :show-close="false">
      <DialogHeader class="component-modal-dialog-header">
        <div class="component-modal-dialog-title-row">
          <div class="form-modal-title-wrap">
            <DialogTitle class="form-modal-title">{{ tagModalTarget?.title || '消息标签' }}</DialogTitle>
            <DialogDescription class="form-modal-desc">选择要关联到这条消息的标签，可多选。</DialogDescription>
          </div>
          <DialogClose as-child>
            <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭弹窗" :disabled="tagModalSaving">×</button>
          </DialogClose>
        </div>
      </DialogHeader>
      <div class="component-modal-dialog-body form-modal-body">
        <div class="tag-modal-options">
          <button
            v-for="tag in presetTags"
            :key="`preset-${tag}`"
            type="button"
            class="app-btn-ghost tag-option-btn"
            :class="{ active: tagModalSelected.includes(tag) }"
            @click="toggleTagSelection(tag)"
          >
            {{ tag }}
          </button>
        </div>
      </div>
      <footer class="component-modal-actions form-modal-actions">
        <button type="button" class="app-btn-ghost" @click="closeTagModal" :disabled="tagModalSaving">取消</button>
        <button type="button" class="app-btn-danger" @click="saveMessageTags" :disabled="tagModalSaving">
          {{ tagModalSaving ? '保存中...' : '保存标签' }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="promptScoreModalOpen" @update:open="(open) => { if (!open) closePromptScoreModal() }">
    <DialogScrollContent class="component-modal-dialog component-modal-dialog--lg component-modal-dialog--tone-info prompt-score-modal" :show-close="false">
      <DialogHeader class="component-modal-dialog-header prompt-score-header">
        <div class="component-modal-dialog-title-row">
          <div class="prompt-score-title-wrap">
            <DialogTitle class="prompt-score-title">Prompt 评分详情</DialogTitle>
            <DialogDescription class="prompt-score-desc">
              启发式规则评分，用于快速自检 Prompt 结构质量，不代表真实输出效果。
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭弹窗">×</button>
          </DialogClose>
        </div>
      </DialogHeader>

      <div class="component-modal-dialog-body prompt-score-body">
      <p class="confirm-text" v-if="promptScoreLoading">评测中...</p>
      <p class="error" v-else-if="promptScoreError">{{ promptScoreError }}</p>

      <template v-else-if="promptScoreResult">
        <div class="prompt-score-meta-row">
          <span class="optimize-chip" data-type="mode">{{ promptScoreResult.scoringMode === 'hybrid' ? '混合评审' : '规则启发式' }}</span>
          <span class="optimize-chip" data-type="mode">任务类型：{{ getPromptTaskTypeLabel(promptScoreResult.taskType || promptScoreTaskType) }}</span>
          <span class="optimize-chip" data-type="time">Rubric：{{ promptScoreResult.rubricVersion }}</span>
          <span class="optimize-chip" data-type="time" v-if="promptScoreResult.contextMeta">
            相关上下文：{{ promptScoreResult.contextMeta.relevantMessages }}/{{ promptScoreResult.contextMeta.totalMessages }}
          </span>
        </div>

        <div class="prompt-effect-panel">
          <div class="prompt-effect-head">
            <div>
              <strong>实战评估</strong>
              <small>
                {{ promptEffectAssessmentResult
                  ? '这里展示最近一次手动实战评估的结果，重新评估后会覆盖保存。'
                  : '进入详情后不会自动调用模型，点击按钮手动评估一次后会保存，下次可直接查看。' }}
              </small>
            </div>
            <div class="prompt-effect-actions">
              <span class="optimize-chip" :data-type="promptEffectAssessmentResult?.cached ? 'cache' : 'fresh'" v-if="promptEffectAssessmentResult">
                {{ promptEffectAssessmentResult.cached ? '上次缓存' : '刚刚生成' }}
              </span>
              <button
                type="button"
                class="app-btn prompt-effect-run-btn"
                @click="runPromptEffectAssessment(!!promptEffectAssessmentResult)"
                :disabled="promptEffectAssessmentLoading || promptEffectAssessmentCacheLoading"
              >
                {{
                  promptEffectAssessmentLoading
                    ? '评估中...'
                    : promptEffectAssessmentResult
                      ? '重新评估'
                      : '手动评估一次'
                }}
              </button>
            </div>
          </div>

          <div class="prompt-effect-method-note">
            <article class="prompt-effect-method-item">
              <strong>实战评估做了什么</strong>
              <p>会把当前 Prompt、任务类型和最近相关上下文发给当前配置的 Assistant 模型，让它只返回结论、置信度、摘要、优势和风险。</p>
            </article>
            <article class="prompt-effect-method-item">
              <strong>评分标准哪来的</strong>
              <p>结构评分来自内置 Rubric，按目标清晰度、上下文充分度、约束完整性、输出可验证性、结构化程度五个维度打分，依据下方列出的 OpenAI、Anthropic、Google 指南。</p>
            </article>
          </div>

          <p class="confirm-text" v-if="promptEffectAssessmentCacheLoading && !promptEffectAssessmentResult">正在读取上次实战评估...</p>
          <p class="error" v-if="promptEffectAssessmentError">{{ promptEffectAssessmentError }}</p>

          <template v-if="promptEffectAssessmentResult">
            <div class="prompt-effect-overview">
              <article class="prompt-effect-verdict-card" :data-verdict="promptEffectAssessmentResult.effectAssessment.verdict">
                <span class="prompt-effect-kicker">本次结论</span>
                <strong>{{ getPromptVerdictLabel(promptEffectAssessmentResult.effectAssessment.verdict) }}</strong>
                <small>
                  {{
                    promptEffectAssessmentResult.effectAssessment.available
                      ? '基于当前模型做的效果预判'
                      : '本次未拿到可用模型评审，保留最近一次返回信息'
                  }}
                </small>
              </article>

              <div class="prompt-effect-metrics">
                <article class="prompt-effect-metric-card">
                  <span>置信度</span>
                  <strong>{{ getPromptEffectConfidence(promptEffectAssessmentResult.effectAssessment.confidence, promptEffectAssessmentResult.effectAssessment.verdict) }}%</strong>
                </article>
                <article class="prompt-effect-metric-card">
                  <span>上次实战时间</span>
                  <strong>{{ formatTime(promptEffectAssessmentResult.updatedAt) }}</strong>
                </article>
                <article class="prompt-effect-metric-card">
                  <span>评审模型</span>
                  <strong>{{ promptEffectAssessmentResult.effectAssessment.model || '未返回' }}</strong>
                </article>
              </div>
            </div>

            <div class="prompt-effect-confidence">
              <div class="prompt-effect-confidence-head">
                <span>结果可信度</span>
                <strong>{{ getPromptEffectConfidence(promptEffectAssessmentResult.effectAssessment.confidence, promptEffectAssessmentResult.effectAssessment.verdict) }} / 100</strong>
              </div>
              <div class="prompt-effect-confidence-track">
                <div
                  class="prompt-effect-confidence-fill"
                  :style="{ width: `${getPromptEffectConfidence(promptEffectAssessmentResult.effectAssessment.confidence, promptEffectAssessmentResult.effectAssessment.verdict)}%` }"
                />
              </div>
            </div>

            <article class="prompt-effect-summary-card" v-if="promptEffectSummaryView.lead || promptEffectSummaryView.sections.length">
              <div class="prompt-effect-summary-head">
                <strong>评估摘要</strong>
                <small>把接口返回内容整理成更易读的摘要结构</small>
              </div>
              <p class="prompt-effect-summary-lead" v-if="promptEffectSummaryView.lead">{{ promptEffectSummaryView.lead }}</p>
              <div class="prompt-effect-summary-sections" v-if="promptEffectSummaryView.sections.length">
                <article class="prompt-effect-summary-section" v-for="(section, index) in promptEffectSummaryView.sections" :key="`effect-summary-${index}-${section.title}`">
                  <strong>{{ section.title }}</strong>
                  <p v-if="section.kind === 'text'">{{ section.text }}</p>
                  <ul class="score-fix-list" v-else-if="section.kind === 'list'">
                    <li v-for="(item, itemIndex) in section.items" :key="`effect-summary-item-${index}-${itemIndex}`">{{ item }}</li>
                  </ul>
                  <div class="prompt-effect-summary-pairs" v-else-if="section.kind === 'pairs'">
                    <div class="prompt-effect-summary-pair" v-for="(pair, pairIndex) in section.pairs" :key="`effect-summary-pair-${index}-${pairIndex}`">
                      <span>{{ pair.label }}</span>
                      <strong>{{ pair.value }}</strong>
                    </div>
                  </div>
                </article>
              </div>
            </article>
            <div
              class="prompt-effect-grid"
              v-if="promptEffectAssessmentResult.effectAssessment.strengths.length || promptEffectAssessmentResult.effectAssessment.risks.length"
            >
            <div class="prompt-effect-block" v-if="promptEffectAssessmentResult.effectAssessment.strengths.length">
              <strong>优势</strong>
              <ul class="score-fix-list">
                <li v-for="(item, idx) in promptEffectAssessmentResult.effectAssessment.strengths" :key="`effect-strength-${idx}`">{{ item }}</li>
              </ul>
            </div>
            <div class="prompt-effect-block" v-if="promptEffectAssessmentResult.effectAssessment.risks.length">
              <strong>风险</strong>
              <ul class="score-fix-list">
                <li v-for="(item, idx) in promptEffectAssessmentResult.effectAssessment.risks" :key="`effect-risk-${idx}`">{{ item }}</li>
              </ul>
            </div>
            </div>
          </template>

          <div class="prompt-effect-empty" v-else-if="!promptEffectAssessmentCacheLoading">
            <p>还没有实战评估结果。点击“手动评估一次”后会调用模型生成，并把这次结果保存起来，之后打开可直接查看。</p>
          </div>
        </div>
        <div class="score-ring-panel">
          <div class="score-ring-wrap">
            <div class="score-ring" :style="getScoreRingStyle(promptScoreResult.scores)">
              <div class="score-ring-center" :data-band="getScoreBand(promptScoreResult.weightedTotal).key">
                <strong>{{ promptScoreResult.weightedTotal }}</strong>
                <span>{{ getScoreBand(promptScoreResult.weightedTotal).emoji }} {{ getScoreBand(promptScoreResult.weightedTotal).label }}</span>
              </div>
            </div>
          </div>
          <div class="score-ring-legend">
            <small>Rubric: {{ promptScoreResult.rubricVersion }}</small>
            <small class="hint" v-if="promptScoreResult.sourceRefs?.scoringPolicy?.description">
              {{ promptScoreResult.sourceRefs.scoringPolicy.description }}
            </small>
            <small class="hint" v-if="promptScoreResult.contextApplied">
              上下文修正：+{{ promptScoreResult.contextAdjustment || 0 }}（基准 {{ promptScoreResult.baseWeightedTotal || promptScoreResult.weightedTotal }}）
            </small>
            <div class="score-legend">
              <div
                class="score-legend-item"
                v-for="item in getPromptScoreDimensions(promptScoreResult.scores)"
                :key="item.key"
              >
                <div class="score-legend-head">
                  <div class="score-legend-label">
                    <span class="score-legend-dot" :style="{ backgroundColor: item.color }" />
                    <span>{{ item.label }}</span>
                  </div>
                  <strong>{{ item.completion }}%</strong>
                </div>
                <div class="score-legend-progress">
                  <div class="score-legend-progress-fill" :style="{ width: `${item.completion}%`, backgroundColor: item.color }" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <details class="collapsible-block" v-if="promptScoreResult.antiPatterns.length" open>
          <summary>命中问题</summary>
          <div class="score-issue-list">
            <div class="score-issue" v-for="issue in promptScoreResult.antiPatterns" :key="`${issue.code}-${issue.evidence}`">
              <p>
                <span class="severity-chip" :data-level="issue.severity">{{ severityLabel(issue.severity) }}</span>
                {{ issue.code }}
                <span class="context-resolved-chip" v-if="issue.resolvedByContext">上下文已补全</span>
              </p>
              <small>{{ issue.message }}</small>
              <small v-if="issue.evidence">证据：{{ issue.evidence }}</small>
              <small v-if="issue.resolvedByContext && issue.resolvedReason">说明：{{ issue.resolvedReason }}</small>
            </div>
          </div>
        </details>

        <details class="collapsible-block" v-if="promptScoreResult.topFixes.length" open>
          <summary>优先改进建议</summary>
          <ul class="score-fix-list">
            <li v-for="(tip, idx) in promptScoreResult.topFixes" :key="`${idx}-${tip}`">{{ tip }}</li>
          </ul>
        </details>

        <details class="collapsible-block" v-if="promptScoreTargetText">
          <summary>当前 Prompt</summary>
          <p class="prompt-preview">{{ promptScoreTargetText }}</p>
        </details>

        <details class="collapsible-block">
          <summary>DSPy 优化示例</summary>
          <div class="dspy-actions">
            <select v-model="promptOptimizeLanguage" class="app-select dspy-lang-select" :disabled="promptOptimizeLoading">
              <option value="zh-CN">中文输出</option>
              <option value="en-US">English Output</option>
            </select>
            <button type="button" class="app-btn-ghost dspy-run-btn" @click="runPromptOptimize(false)" :disabled="promptOptimizeLoading">
              {{ promptOptimizeLoading ? '优化中...' : '获取优化示例' }}
            </button>
            <button
              v-if="promptOptimizeResult"
              type="button"
              class="app-btn-ghost dspy-run-btn"
              @click="runPromptOptimize(true)"
              :disabled="promptOptimizeLoading"
            >
              重新生成
            </button>
          </div>
          <p class="confirm-text" v-if="promptOptimizeLoading">正在通过 DSPy 优化当前 Prompt...</p>
          <p class="error" v-else-if="promptOptimizeError">{{ promptOptimizeError }}</p>
          <template v-else-if="promptOptimizeResult">
            <div class="optimize-meta-row">
              <span class="optimize-chip" :data-type="promptOptimizeResult.cached ? 'cache' : 'fresh'">
                {{ promptOptimizeResult.cached ? '来自缓存' : '新生成' }}
              </span>
              <span class="optimize-chip" data-type="mode">模式：{{ promptOptimizeResult.mode }}</span>
              <span class="optimize-chip" data-type="time" v-if="promptOptimizeResult.updatedAt">
                生成时间：{{ formatTime(promptOptimizeResult.updatedAt) }}
              </span>
              <span class="optimize-chip" data-type="time" v-else-if="promptOptimizeResult.createdAt">
                生成时间：{{ formatTime(promptOptimizeResult.createdAt) }}
              </span>
              <span class="optimize-chip" data-type="model" v-if="promptOptimizeResult.meta?.model">
                模型：{{ promptOptimizeResult.meta?.model }}
              </span>
            </div>
            <p class="warn" v-if="promptOptimizeResult.mode === 'fallback' && promptOptimizeResult.meta?.fallbackReason">
              {{ promptOptimizeResult.meta?.fallbackReason }}
            </p>
            <div
              class="prompt-preview optimized-preview md-content"
              v-html="renderMarkdown(stripOuterCodeFence(promptOptimizeResult.optimizedPrompt))"
            />
            <div class="prompt-score-block" v-if="promptOptimizeResult.changes?.length">
              <strong>改写点</strong>
              <ul class="score-fix-list">
                <li v-for="(item, idx) in promptOptimizeResult.changes" :key="`opt-change-${idx}`">
                  <div class="md-content compact-md" v-html="renderMarkdown(item)" />
                </li>
              </ul>
            </div>
            <div class="prompt-score-block" v-if="promptOptimizeResult.rationale?.length">
              <strong>原因说明</strong>
              <ul class="score-fix-list">
                <li v-for="(item, idx) in promptOptimizeResult.rationale" :key="`opt-rationale-${idx}`">
                  <div class="md-content compact-md" v-html="renderMarkdown(item)" />
                </li>
              </ul>
            </div>
          </template>
        </details>

        <details class="collapsible-block" v-if="collectPromptSources(promptScoreResult).length">
          <summary>评分依据来源</summary>
          <div class="source-radar-wrap">
            <svg
              class="source-radar"
              :viewBox="`0 0 ${getSourceRadar(promptScoreResult).size} ${getSourceRadar(promptScoreResult).size}`"
              role="img"
              aria-label="评分依据命中雷达图"
            >
              <circle
                v-for="ring in getSourceRadar(promptScoreResult).rings"
                :key="`ring-${ring.ratio}`"
                :cx="getSourceRadar(promptScoreResult).center"
                :cy="getSourceRadar(promptScoreResult).center"
                :r="ring.r"
                class="source-radar-ring"
              />
              <line
                v-for="point in getSourceRadar(promptScoreResult).points"
                :key="`axis-${point.key}`"
                :x1="getSourceRadar(promptScoreResult).center"
                :y1="getSourceRadar(promptScoreResult).center"
                :x2="point.axisX"
                :y2="point.axisY"
                class="source-radar-axis"
              />
              <polygon :points="getSourceRadar(promptScoreResult).polygon" class="source-radar-area" />
              <circle
                v-for="point in getSourceRadar(promptScoreResult).points"
                :key="`node-${point.key}`"
                :cx="point.x"
                :cy="point.y"
                r="3.2"
                class="source-radar-node"
              />
              <text
                v-for="point in getSourceRadar(promptScoreResult).points"
                :key="`label-${point.key}`"
                :x="point.labelX + point.labelOffset"
                :y="point.labelY"
                class="source-radar-label"
                :text-anchor="point.anchor"
                dominant-baseline="middle"
              >
                {{ point.labelText }}
              </text>
            </svg>
            <div class="source-radar-brief">
              <span v-for="item in getSourceLegend(promptScoreResult)" :key="`brief-${item.key}`">
                {{ item.name }}：{{ item.hit }}/{{ item.total }}
              </span>
            </div>
          </div>
          <div class="score-source-list">
            <a
              v-for="ref in collectPromptSources(promptScoreResult)"
              :key="ref.id"
              class="score-source-link"
              :href="ref.url"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ ref.title }}
            </a>
          </div>
          <small class="hint" v-if="promptScoreResult.sourceRefs?.antiPatternPolicy?.description">
            {{ promptScoreResult.sourceRefs.antiPatternPolicy.description }}
          </small>
        </details>
      </template>

      </div>

      <footer class="component-modal-actions form-modal-actions">
        <button type="button" class="app-btn-secondary" @click="closePromptScoreModal">关闭</button>
      </footer>
    </DialogScrollContent>
  </Dialog>

  <Dialog :open="feishuBindModalOpen" @update:open="(open) => { if (!open) closeFeishuBindModal() }">
    <DialogContent class="component-modal-dialog component-modal-dialog--lg component-modal-dialog--tone-info feishu-bind-dialog" :show-close="false">
      <DialogHeader class="component-modal-dialog-header feishu-bind-dialog-header">
        <div class="component-modal-dialog-title-row">
          <div class="feishu-bind-dialog-title-wrap">
            <DialogTitle class="feishu-bind-dialog-title">
              <IconLink2 :size="16" class="feishu-bind-dialog-title-icon" />
              <span>飞书 Bug 绑定</span>
            </DialogTitle>
            <DialogDescription class="feishu-bind-dialog-desc">
              为当前记录选择要绑定的飞书缺陷
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭弹窗">×</button>
          </DialogClose>
        </div>
      </DialogHeader>
      <Separator class="feishu-bind-dialog-separator" />
      <div class="component-modal-dialog-body feishu-bind-body">
        <section class="feishu-current-bug-card">
          <div class="feishu-current-head">
            <small class="feishu-current-label">当前 Bug</small>
            <span class="feishu-current-status">
              {{ feishuBindTargetBug && feishuBindTargetBug.feishuUrl ? '已存在绑定' : '待绑定' }}
            </span>
          </div>
          <p class="feishu-current-title">{{ feishuBindTargetBug?.title || feishuBindTargetBug?.patchFile || '-' }}</p>
          <p class="feishu-current-sub" v-if="feishuBindTargetBug?.description">{{ feishuBindTargetBug?.description }}</p>
          <div
            v-if="feishuBindTargetBug?.patchPath || feishuBindTargetBug?.conversationId"
            class="feishu-current-meta"
          >
            <span v-if="feishuBindTargetBug?.patchPath">{{ feishuBindTargetBug.patchPath }}</span>
            <span v-if="feishuBindTargetBug?.conversationId">会话 {{ feishuBindTargetBug.conversationId }}</span>
          </div>
        </section>
        <div class="feishu-bind-summary" v-if="!feishuBindLoading && !feishuBindError">
          <span class="feishu-bind-summary-chip">
            候选 {{ feishuBindCandidates.length }}
          </span>
          <span class="feishu-bind-summary-chip" :data-tone="feishuBindSelectedCandidateKey ? 'selected' : 'idle'">
            {{ feishuBindSelectedCandidateKey ? '已选择 1 条候选' : '请选择 1 条候选' }}
          </span>
        </div>
        <p class="warn" v-if="feishuBindLoading">候选读取中...</p>
        <p class="error" v-else-if="feishuBindError">{{ feishuBindError }}</p>
        <div class="feishu-candidate-list" v-else-if="feishuBindCandidates.length">
          <ul
            class="component-list-preview component-list-preview--cards component-list-preview--bordered component-list-preview--rounded component-list-preview--tone-soft component-list-preview--hoverable feishu-defect-list feishu-bind-candidate-list"
          >
            <li
              v-for="candidate in feishuBindCandidates"
              :key="getFeishuCandidateKey(candidate)"
              class="component-list-item feishu-bind-candidate-item"
              :class="{
                selected: isFeishuCandidateSelected(candidate),
                disabled: !feishuBindTargetBug || Boolean(feishuBindLinkingKey),
              }"
              role="button"
              :tabindex="!feishuBindTargetBug || Boolean(feishuBindLinkingKey) ? -1 : 0"
              :aria-disabled="!feishuBindTargetBug || Boolean(feishuBindLinkingKey)"
              @click="(!feishuBindTargetBug || Boolean(feishuBindLinkingKey)) ? undefined : selectFeishuCandidate(candidate)"
              @keydown.enter.prevent="(!feishuBindTargetBug || Boolean(feishuBindLinkingKey)) ? undefined : selectFeishuCandidate(candidate)"
              @keydown.space.prevent="(!feishuBindTargetBug || Boolean(feishuBindLinkingKey)) ? undefined : selectFeishuCandidate(candidate)"
            >
              <div class="component-list-leading">
                <span class="component-list-avatar" :data-tone="getFeishuCandidateStatusTone(candidate)">
                  {{ getFeishuCandidateAvatarText(candidate) }}
                </span>
              </div>
              <div class="component-list-main">
                <div class="component-list-top feishu-bind-candidate-head">
                  <div class="feishu-bind-candidate-title-block">
                    <strong>{{ candidate.title || candidate.id || '未命名缺陷' }}</strong>
                    <small class="feishu-bind-candidate-id">{{ candidate.id || '缺少 ID' }}</small>
                  </div>
                  <div class="component-list-flags">
                    <span
                      v-if="getFeishuCandidateSeverity(candidate) !== '-'"
                      class="feishu-severity-chip"
                      :data-level="getFeishuCandidateSeverityLevel(candidate)"
                    >
                      {{ getFeishuCandidateSeverity(candidate) }}
                    </span>
                    <span class="component-list-status" :data-tone="getFeishuCandidateStatusTone(candidate)">
                      {{ candidate.status || '未设置' }}
                    </span>
                    <span class="component-list-flag warn" v-if="isFeishuCurrentBoundCandidate(candidate)">当前绑定</span>
                    <span class="feishu-bind-choice" :data-selected="isFeishuCandidateSelected(candidate)">
                      {{ isFeishuCandidateSelected(candidate) ? '已选择' : '点击选择' }}
                    </span>
                  </div>
                </div>
                <p class="component-list-subtitle feishu-bind-candidate-meta">{{ getFeishuCandidateReporter(candidate) }} · {{ getFeishuCandidateCreatedAt(candidate) }}</p>
                <div
                  class="component-list-tags feishu-bind-candidate-tags"
                  v-if="
                    getFeishuCandidateRequirement(candidate) !== '-' ||
                    getFeishuCandidateDiscoveryStage(candidate) !== '-' ||
                    getFeishuCandidateCategory(candidate) !== '-' ||
                    Boolean(candidate.creator)
                  "
                >
                  <span v-if="getFeishuCandidateRequirement(candidate) !== '-'" class="feishu-defect-tag feishu-defect-tag--requirement">
                    {{ getFeishuCandidateRequirement(candidate) }}
                  </span>
                  <span v-if="getFeishuCandidateDiscoveryStage(candidate) !== '-'" class="feishu-defect-tag feishu-defect-tag--discovery">
                    {{ getFeishuCandidateDiscoveryStage(candidate) }}
                  </span>
                  <span v-if="getFeishuCandidateCategory(candidate) !== '-'" class="feishu-defect-tag feishu-defect-tag--category">
                    {{ getFeishuCandidateCategory(candidate) }}
                  </span>
                  <span v-if="candidate.creator" class="feishu-defect-tag feishu-defect-tag--creator">{{ candidate.creator }}</span>
                </div>
              </div>
            </li>
          </ul>
        </div>
        <p class="warn" v-else>没有可绑定候选</p>
      </div>
      <footer class="component-modal-actions feishu-bind-actions">
        <button type="button" class="app-btn-ghost" @click="closeFeishuBindModal" :disabled="Boolean(feishuBindLinkingKey)">取消</button>
        <button class="app-btn"
          type="button"
          @click="confirmFeishuBindSelection"
          :disabled="!feishuBindTargetBug || !feishuBindSelectedCandidateKey || Boolean(feishuBindLinkingKey)"
        >
          {{ feishuBindLinkingKey ? '绑定中...' : '确认绑定' }}
        </button>
      </footer>
    </DialogContent>
  </Dialog>

  <Dialog :open="bugInboxDetailModalOpen" @update:open="(open) => { if (!open) closeBugInboxDetail() }">
    <DialogContent
      class="component-modal-dialog component-modal-dialog--md component-modal-dialog--tone-info bug-detail-dialog"
      :show-close="false"
    >
      <DialogHeader class="component-modal-dialog-header bug-detail-dialog-header">
        <div class="component-modal-dialog-title-row">
          <div class="bug-detail-dialog-title-wrap">
            <DialogTitle class="bug-detail-dialog-title">
              <IconBug :size="16" class="bug-detail-dialog-title-icon" />
              <span>Bug 详情</span>
            </DialogTitle>
            <DialogDescription class="bug-detail-dialog-desc">
              Bug Inbox 字段详情
            </DialogDescription>
          </div>
          <DialogClose as-child>
            <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭详情">
              ×
            </button>
          </DialogClose>
        </div>
      </DialogHeader>

      <Separator class="bug-detail-dialog-separator" />

      <div class="component-modal-dialog-body bug-detail-dialog-body">
        <div class="bug-detail-field-list">
          <div
            v-for="field in bugInboxDetailFields"
            :key="field.key"
            class="bug-detail-field-item"
            :class="{ 'bug-detail-field-item--wide': field.kind === 'pre' || field.kind === 'code' || field.kind === 'path' || field.kind === 'link' || String(field.display || '').length > 120 }"
          >
            <div class="bug-detail-field-label-row">
              <button
                v-if="field.copyable"
                type="button"
                class="bug-detail-field-label-btn"
                :title="`点击复制 ${field.label}`"
                :aria-label="`点击复制 ${field.label}`"
                @click="copyBugDetailField(field.display)"
              >
                <span class="bug-detail-field-label-copy" aria-hidden="true">
                  <IconCopy :size="12" />
                </span>
                <span class="bug-detail-field-label">{{ field.label }}</span>
              </button>
              <p v-else class="bug-detail-field-label">{{ field.label }}</p>
            </div>

            <div class="bug-detail-field-box" :class="{ 'bug-detail-field-box-pre': field.kind === 'pre' || field.kind === 'code' }">
              <Badge
                v-if="field.kind === 'badge'"
                variant="outline"
                class="bug-detail-value-badge"
              >
                {{ field.display }}
              </Badge>

              <p v-else-if="field.kind === 'datetime'" class="bug-detail-value-datetime">{{ field.display }}</p>

              <div v-else-if="field.kind === 'link'" class="bug-detail-value-link-wrap">
                <a
                  v-if="field.href"
                  :href="field.href"
                  target="_blank"
                  rel="noreferrer"
                  class="bug-detail-value-link"
                >
                  {{ field.display }}
                </a>
                <span v-else class="bug-detail-value-link bug-detail-value-link--static">
                  {{ field.display }}
                </span>
              </div>

              <div v-else-if="field.kind === 'path'" class="bug-detail-value-path-wrap">
                <code class="bug-detail-value-path">{{ field.display }}</code>
              </div>

              <div v-else-if="field.kind === 'code'" class="bug-detail-value-code-wrap">
                <CodeSyntaxBlock
                  :code="field.display"
                  :default-language="inferBugDetailCodeLanguage(field)"
                  max-height="240px"
                />
              </div>

              <div
                v-else-if="field.kind === 'pre'"
                class="bug-detail-value-pre-wrap"
              >
                <CodeSyntaxBlock
                  :code="field.display"
                  :default-language="inferBugDetailCodeLanguage(field)"
                  max-height="300px"
                />
              </div>

              <p v-else class="bug-detail-value-text">{{ field.display }}</p>
            </div>
          </div>
        </div>
      </div>

      <footer class="component-modal-actions bug-detail-dialog-actions">
        <button type="button" class="app-btn-ghost" @click="closeBugInboxDetail">关闭</button>
      </footer>
    </DialogContent>
  </Dialog>
</template>
