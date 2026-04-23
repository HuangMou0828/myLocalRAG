<script setup lang="ts">
import { computed } from 'vue'
import { IconDatabase, IconFolderOpen, IconRefreshCw, IconSettings2, IconSparkles, IconUpload } from '@/components/icons/app-icons'
import type { AppToolbarConfig } from '@/features/app/appShellComponentConfigs'

const props = defineProps<{
  config: AppToolbarConfig
}>()

const config = computed(() => props.config)

const feishuScheduleLoading = computed(() =>
  config.value.feishuSchedule.dataFilter === 'defect'
    ? config.value.feishuSchedule.defectLoading
    : config.value.feishuSchedule.todoLoading,
)

const feishuScheduleTitle = computed(() =>
  config.value.feishuSchedule.dataFilter === 'defect'
    ? (config.value.feishuSchedule.defectLoading ? '刷新中' : '刷新飞书缺陷')
    : (config.value.feishuSchedule.todoLoading ? '刷新中' : '刷新飞书待办'),
)

const feishuScheduleAriaLabel = computed(() =>
  config.value.feishuSchedule.dataFilter === 'defect'
    ? '刷新飞书缺陷'
    : '刷新飞书待办',
)

const syncProviderLabelMap: Record<string, string> = {
  codex: 'Codex',
  cursor: 'Cursor',
  'claude-code': 'Claude Code',
}
const isSyncProvider = computed(() => ['cursor', 'codex', 'claude-code'].includes(config.value.provider.active))
const syncProviderLabel = computed(() => syncProviderLabelMap[config.value.provider.active] || '当前来源')
const isKnowledgeProvider = computed(() => String(config.value.provider.active || '').startsWith('knowledge-'))
const toolbarProviderLabel = computed(() =>
  String(config.value.provider.active || '')
    .replace(/^knowledge-/, '')
    .replace(/-/g, ' ')
    .trim()
    || '',
)
const showEmbeddingAction = computed(() =>
  config.value.provider.active !== 'bug-cursor'
  && config.value.provider.active !== 'feishu-master'
  && config.value.provider.active !== 'component-library'
  && config.value.provider.active !== 'model-settings'
  && !isKnowledgeProvider.value,
)
const showImportAction = computed(() =>
  config.value.provider.active !== 'cursor'
  && config.value.provider.active !== 'codex'
  && config.value.provider.active !== 'claude-code'
  && config.value.provider.active !== 'bug-cursor'
  && config.value.provider.active !== 'feishu-master'
  && config.value.provider.active !== 'component-library'
  && config.value.provider.active !== 'model-settings'
  && !isKnowledgeProvider.value,
)
const showPrimaryCaptureAction = computed(() => !config.value.modes.isSpecial || config.value.modes.isKnowledgeSources)
const showToolbarSecondaryActions = computed(() =>
  showPrimaryCaptureAction.value
  || showImportAction.value
  || config.value.feishuSchedule.isTodoView,
)
const showSyncWikiAction = computed(() => isKnowledgeProvider.value)
const showToolbarUtilityCluster = computed(() =>
  showSyncWikiAction.value
  || config.value.modes.isFeishuSchedule
  || (config.value.modes.isBugLocator && config.value.navigation.bugTraceSubMenu === 'trace')
  || isSyncProvider.value
  || showEmbeddingAction.value
)
const knowledgeToolbarDescription = computed(() => {
  if (config.value.provider.active === 'knowledge-task-review') return '先按任务视角筛掉噪声和上下文碎片，再决定是否进入主检索'
  if (config.value.provider.active === 'knowledge-promotion-review') return '把接近稳定的候选集中审核，避免直接把正式 wiki 写乱'
  if (config.value.provider.active === 'knowledge-health') return '持续查看 lint、知识空洞和长期积压提醒，保持 wiki 可维护'
  return '先收集原始片段、主观笔记和完整文档，再决定怎么编译成 wiki'
})

const toolbarContext = computed(() => {
  if (!config.value.modes.isSpecial) {
    return {
      eyebrow: 'Session Workspace',
      title: config.value.navigation.activeMainTitle,
      description: '跨来源检索历史会话、查看命中证据，并在右侧阅读完整上下文。',
    }
  }

  if (config.value.modes.isBugLocator) {
    return {
      eyebrow: 'Review Tool',
      title: config.value.navigation.bugTraceSubMenu === 'inbox' ? 'Bug Inbox' : 'Bug 代码反查',
      description: config.value.navigation.bugTraceSubMenu === 'trace'
        ? '输入可疑代码或 patch 线索，定位对应会话与变更证据。'
        : '查看已入库 bug、绑定状态和后续处理动作。',
    }
  }

  if (config.value.modes.isFeishuSchedule) {
    return {
      eyebrow: 'Review Tool',
      title: '飞书排期 Todo',
      description: '集中处理飞书待办、缺陷候选和下一步动作。',
    }
  }

  if (config.value.modes.isModelSettings) {
    return {
      eyebrow: 'System Settings',
      title: '模型管理',
      description: '查看系统使用的模型实例、用途归属和配置完整度。',
    }
  }

  if (config.value.modes.isKnowledgeSources) {
    return {
      eyebrow: 'Knowledge Workbench',
      title: config.value.navigation.activeMainTitle,
      description: knowledgeToolbarDescription.value,
    }
  }

  if (config.value.modes.isComponentLibrary) {
    return {
      eyebrow: 'Component Workbench',
      title: config.value.navigation.activeMainTitle,
      description: '统一预览组件结构、状态、反馈和交互细节。',
    }
  }

  return {
    eyebrow: 'Workspace',
    title: config.value.navigation.activeMainTitle,
    description: '当前区域的上下文与操作入口。',
  }
})
</script>

<template>
  <div class="toolbar toolbar-shell">
    <div class="toolbar-context">
      <div class="toolbar-meta-row">
        <span class="toolbar-eyebrow">{{ toolbarContext.eyebrow }}</span>
        <span class="toolbar-provider-pill" v-if="toolbarProviderLabel">{{ toolbarProviderLabel }}</span>
      </div>
      <div class="toolbar-title">
        <h1>{{ toolbarContext.title }}</h1>
        <small>{{ toolbarContext.description }}</small>
      </div>
    </div>

    <div class="actions toolbar-actions">
      <div v-if="showToolbarSecondaryActions" class="toolbar-secondary-actions">
        <button
          v-if="showPrimaryCaptureAction"
          type="button"
          class="app-btn toolbar-primary-action"
          @click="config.actions.openQuickCapture"
          title="快速采集"
          aria-label="快速采集"
        >
          <IconSparkles :size="16" />
          <span>快速采集</span>
        </button>

        <button
          v-if="showImportAction"
          class="app-btn-secondary toolbar-secondary-action"
          type="button"
          @click="config.actions.openImportModal"
        >
          <IconFolderOpen :size="16" />
          <span>导入数据</span>
        </button>

        <button
          v-if="config.feishuSchedule.isTodoView"
          type="button"
          class="app-btn-secondary toolbar-secondary-action"
          @click="config.actions.openFeishuBatchModal"
          :disabled="!config.feishuSchedule.selectedTodosCount || config.feishuSchedule.todoLoading"
          :title="config.feishuSchedule.selectedTodosCount ? `批量处理 ${config.feishuSchedule.selectedTodosCount} 条` : '请先选择待办'"
        >
          批量处理{{ config.feishuSchedule.selectedTodosCount ? `（${config.feishuSchedule.selectedTodosCount}）` : '' }}
        </button>
      </div>

      <div v-if="showToolbarUtilityCluster" class="toolbar-action-cluster">
        <button
          v-if="showSyncWikiAction"
          type="button"
          class="icon-btn"
          @click="config.actions.syncWikiVault"
          :disabled="config.wikiVault.syncing"
          :title="config.wikiVault.syncing ? '发布到 Obsidian Vault 中' : '发布到 Obsidian Vault'"
          :aria-label="config.wikiVault.syncing ? '发布到 Obsidian Vault 中' : '发布到 Obsidian Vault'"
        >
          <IconRefreshCw v-if="config.wikiVault.syncing" :size="18" class="animate-spin" />
          <IconUpload v-else :size="18" />
        </button>

        <button
          v-if="config.modes.isFeishuSchedule"
          class="icon-btn"
          type="button"
          @click="config.actions.openFeishuProjectSettings"
          title="飞书账号切换"
          aria-label="飞书账号切换"
        >
          <IconSettings2 :size="18" />
        </button>

        <button
          v-if="config.modes.isBugLocator && config.navigation.bugTraceSubMenu === 'trace'"
          class="icon-btn"
          type="button"
          @click="config.actions.openPatchDirSettings"
          title="Patch 路径设置"
          aria-label="Patch 路径设置"
        >
          <IconSettings2 :size="18" />
        </button>

        <button
          v-if="isSyncProvider"
          class="icon-btn sync-icon-btn"
          type="button"
          @click="config.actions.refreshCurrentProvider"
          :disabled="config.provider.refreshing"
          :title="config.provider.refreshing ? '更新中' : `从本地源更新 ${syncProviderLabel}`"
          :aria-label="`更新 ${syncProviderLabel} 来源`"
        >
          <IconRefreshCw v-if="config.provider.refreshing" :size="18" class="animate-spin" />
          <IconRefreshCw v-else :size="18" />
        </button>

        <button
          v-if="showEmbeddingAction"
          class="icon-btn"
          type="button"
          @click="config.actions.openEmbeddingBuildModal"
          title="手动构建向量"
          aria-label="手动构建向量"
        >
          <IconDatabase :size="18" />
        </button>

        <button
          v-if="config.modes.isFeishuSchedule"
          class="icon-btn"
          type="button"
          @click="config.actions.refreshFeishuSchedule"
          :disabled="feishuScheduleLoading"
          :title="feishuScheduleTitle"
          :aria-label="feishuScheduleAriaLabel"
        >
          <IconRefreshCw v-if="feishuScheduleLoading" :size="18" class="animate-spin" />
          <IconRefreshCw v-else :size="18" />
        </button>
      </div>
    </div>
  </div>
</template>
