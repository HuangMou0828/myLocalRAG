<script setup lang="ts">
import { computed, unref } from 'vue'
import ConfigDataTable from '@/components/ConfigDataTable.vue'

const props = defineProps<{ ctx: Record<string, any> }>()

const {
  isFeishuScheduleMode,
  feishuScheduleDataFilter,
  setFeishuScheduleDataFilter,
  isFeishuScheduleDefectView,
  isFeishuScheduleTodoView,
  feishuTodoError,
  feishuDefectError,
  feishuTodoColumns,
  feishuTodoItems,
  feishuTodoLoading,
  FEISHU_TODO_COLUMN_WIDTHS_STORAGE_KEY,
  allFeishuTodoSelected,
  toggleSelectAllFeishuTodos,
  feishuTodoSelectedIds,
  asFeishuTodoRow,
  toggleFeishuTodoSelection,
  getFeishuTodoDeadlineStatus,
  runFeishuTodoNextStep,
  feishuTodoNextStepLoadingId,
  feishuDefectLoading,
  feishuDefectItems,
  getFeishuCandidateKey,
  getFeishuCandidateStatusTone,
  getFeishuCandidateAvatarText,
  getFeishuCandidateSeverity,
  getFeishuCandidateSeverityLevel,
  getFeishuCandidateReporter,
  getFeishuCandidateCreatedAt,
  getFeishuCandidateRequirement,
  getFeishuCandidateDiscoveryStage,
  getFeishuCandidateCategory,
  openFeishuCandidateUrl,
} = props.ctx

const todoItemsView = computed(() => {
  const items = unref(feishuTodoItems)
  return Array.isArray(items) ? items : []
})

const defectItemsView = computed(() => {
  const items = unref(feishuDefectItems)
  return Array.isArray(items) ? items : []
})

const isDefectView = computed(() => Boolean(unref(isFeishuScheduleDefectView)))
const isTodoView = computed(() => Boolean(unref(isFeishuScheduleTodoView)))

const feishuMasterModeLabel = computed(() => (isDefectView.value ? '飞书缺陷' : '飞书排期'))
const feishuMasterModeDesc = computed(() => (
  isDefectView.value
    ? '聚焦换绑候选和缺陷状态，快速判断当前需要关联的飞书缺陷。'
    : '集中处理飞书待办与下一步动作，减少逐条切换的成本。'
))

const feishuTodoSelectedCount = computed(() => {
  const selectedIds = unref(feishuTodoSelectedIds)
  if (!(selectedIds instanceof Set)) return 0
  return selectedIds.size
})

const feishuTodoOverdueCount = computed(() => (
  todoItemsView.value.filter((row) => {
    const tone = getFeishuTodoDeadlineStatus(asFeishuTodoRow(row))?.tone
    return tone === 'overdue' || tone === 'today'
  }).length
))

const feishuDefectHighPriorityCount = computed(() => (
  defectItemsView.value.filter((item) => {
    const level = String(getFeishuCandidateSeverityLevel(item) || '').toLowerCase()
    return level === 'critical' || level === 'high'
  }).length
))
</script>

<template>
          <div class="bug-inbox-panel feishu-master-panel" v-if="isFeishuScheduleMode">
            <section class="feishu-master-overview">
              <div class="feishu-master-overview-copy">
                <strong>{{ feishuMasterModeLabel }}</strong>
                <p>{{ feishuMasterModeDesc }}</p>
              </div>
              <div class="feishu-master-overview-metrics">
                <span class="feishu-master-metric-chip">
                  <em>当前视图</em>
                  <strong>{{ isFeishuScheduleDefectView ? '缺陷' : '排期' }}</strong>
                </span>
                <span class="feishu-master-metric-chip">
                  <em>总数</em>
                  <strong>{{ isFeishuScheduleDefectView ? defectItemsView.length : todoItemsView.length }}</strong>
                </span>
                <span
                  v-if="isFeishuScheduleTodoView"
                  class="feishu-master-metric-chip"
                  data-tone="warning"
                >
                  <em>待处理</em>
                  <strong>{{ feishuTodoOverdueCount }}</strong>
                </span>
                <span
                  v-if="isFeishuScheduleTodoView"
                  class="feishu-master-metric-chip"
                  data-tone="selected"
                >
                  <em>已选择</em>
                  <strong>{{ feishuTodoSelectedCount }}</strong>
                </span>
                <span
                  v-if="isFeishuScheduleDefectView"
                  class="feishu-master-metric-chip"
                  data-tone="danger"
                >
                  <em>高优先级</em>
                  <strong>{{ feishuDefectHighPriorityCount }}</strong>
                </span>
              </div>
            </section>

            <div class="feishu-data-filter-row feishu-master-filter-row">
              <div class="feishu-data-filter-control">
                <small>数据筛选</small>
                <div class="mini-tabs" role="tablist" aria-label="排期大师数据筛选">
                  <button
                    type="button"
                    class="mini-tab-btn"
                    role="tab"
                    :aria-selected="feishuScheduleDataFilter === 'defect'"
                    :class="{ active: feishuScheduleDataFilter === 'defect' }"
                    @click="setFeishuScheduleDataFilter('defect')"
                  >
                    缺陷
                  </button>
                  <button
                    type="button"
                    class="mini-tab-btn"
                    role="tab"
                    :aria-selected="feishuScheduleDataFilter === 'schedule'"
                    :class="{ active: feishuScheduleDataFilter === 'schedule' }"
                    @click="setFeishuScheduleDataFilter('schedule')"
                  >
                    排期
                  </button>
                </div>
              </div>
              <small class="feishu-data-filter-hint" v-if="isFeishuScheduleDefectView">缺陷数据源：换绑 Bug 候选列表</small>
              <small class="feishu-data-filter-hint" v-else>排期数据源：飞书待办列表与下一步动作</small>
            </div>

            <p class="error" v-if="isFeishuScheduleTodoView && feishuTodoError">{{ feishuTodoError }}</p>
            <p class="error" v-if="isFeishuScheduleDefectView && feishuDefectError">{{ feishuDefectError }}</p>

            <section v-if="isFeishuScheduleTodoView" class="feishu-master-surface">
              <header class="feishu-master-view-head">
                <div>
                  <strong>飞书待办</strong>
                  <small>按截止时间和下一步动作集中处理当前排期事项。</small>
                </div>
                <div class="feishu-master-view-meta">
                  <span class="feishu-master-view-chip">共 {{ todoItemsView.length }} 条</span>
                  <span class="feishu-master-view-chip" data-tone="selected">选中 {{ feishuTodoSelectedCount }}</span>
                </div>
              </header>

              <ConfigDataTable
                table-class="feishu-todo-table"
                :columns="feishuTodoColumns"
                :rows="feishuTodoItems as unknown as Array<Record<string, unknown>>"
                row-key="id"
                :loading="feishuTodoLoading"
                loading-text="飞书待办加载中..."
                empty-text="暂无待办，或者飞书接口暂未返回数据。"
                :storage-key="FEISHU_TODO_COLUMN_WIDTHS_STORAGE_KEY"
              >
                <template #head-selector>
                  <input
                    class="app-input table-checkbox"
                    type="checkbox"
                    :checked="allFeishuTodoSelected"
                    @change="toggleSelectAllFeishuTodos"
                    :aria-label="allFeishuTodoSelected ? '取消全选待办' : '全选待办'"
                  />
                </template>
                <template #cell-selector="{ row }">
                  <input
                    class="app-input table-checkbox"
                    type="checkbox"
                    :checked="feishuTodoSelectedIds.has(asFeishuTodoRow(row).id)"
                    @change="toggleFeishuTodoSelection(asFeishuTodoRow(row).id)"
                    :aria-label="`选择 ${asFeishuTodoRow(row).title || asFeishuTodoRow(row).id}`"
                  />
                </template>
                <template #cell-status="{ row }">
                  <span class="todo-status-chip" :data-tone="getFeishuTodoDeadlineStatus(asFeishuTodoRow(row)).tone">
                    {{ getFeishuTodoDeadlineStatus(asFeishuTodoRow(row)).label }}
                  </span>
                </template>
                <template #cell-actions="{ row }">
                  <button
                    type="button"
                    class="app-btn-ghost bug-inbox-detail-btn"
                    @click="runFeishuTodoNextStep(asFeishuTodoRow(row))"
                    :disabled="feishuTodoNextStepLoadingId === asFeishuTodoRow(row).id"
                  >
                    {{ feishuTodoNextStepLoadingId === asFeishuTodoRow(row).id ? '处理中...' : '下一步' }}
                  </button>
                </template>
              </ConfigDataTable>
            </section>

            <section v-else class="feishu-master-surface feishu-defect-list-wrap">
              <header class="feishu-master-view-head">
                <div>
                  <strong>飞书缺陷候选</strong>
                  <small>浏览候选缺陷的优先级、状态和归属，快速确认当前应关联的记录。</small>
                </div>
                <div class="feishu-master-view-meta">
                  <span class="feishu-master-view-chip">共 {{ defectItemsView.length }} 条</span>
                  <span class="feishu-master-view-chip" data-tone="danger">高优先级 {{ feishuDefectHighPriorityCount }}</span>
                </div>
              </header>
              <div v-if="feishuDefectLoading" class="feishu-defect-skeleton-list">
                <div class="component-list-skeleton" v-for="i in 4" :key="`feishu-defect-skeleton-${i}`">
                  <div class="component-list-skeleton-avatar" />
                  <div class="component-list-skeleton-lines">
                    <span />
                    <span />
                  </div>
                </div>
              </div>
              <div v-else-if="!feishuDefectItems.length" class="component-list-empty">暂无缺陷候选，或者飞书接口暂未返回数据。</div>
              <ul
                v-else
                class="component-list-preview component-list-preview--cards component-list-preview--bordered component-list-preview--rounded component-list-preview--tone-soft component-list-preview--hoverable feishu-defect-list"
              >
                <li
                  v-for="candidate in feishuDefectItems"
                  :key="getFeishuCandidateKey(candidate)"
                  class="component-list-item feishu-master-candidate-item"
                >
                  <div class="component-list-leading">
                    <span class="component-list-avatar" :data-tone="getFeishuCandidateStatusTone(candidate)">
                      {{ getFeishuCandidateAvatarText(candidate) }}
                    </span>
                  </div>
                  <div class="component-list-main">
                    <div class="component-list-top feishu-master-candidate-head">
                      <div class="feishu-master-candidate-title-block">
                        <strong>{{ candidate.title || '未命名缺陷' }}</strong>
                        <small class="feishu-master-candidate-id">{{ candidate.id || '缺少 ID' }}</small>
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
                      </div>
                    </div>
                    <p class="component-list-subtitle feishu-master-candidate-meta">{{ getFeishuCandidateReporter(candidate) }} · {{ getFeishuCandidateCreatedAt(candidate) }}</p>
                    <div
                      class="component-list-tags feishu-master-candidate-tags"
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
                    <div class="component-list-actions" v-if="candidate.url">
                      <button
                        type="button"
                        class="app-btn-ghost bug-inbox-detail-btn"
                        @click="openFeishuCandidateUrl(candidate)"
                      >
                        打开飞书
                      </button>
                    </div>
                  </div>
                </li>
              </ul>
            </section>
          </div>
</template>
