<script setup lang="ts">
import { computed, unref } from 'vue'
import { IconCheck, IconCopy } from '@/components/icons/app-icons'
import CodeSyntaxBlock from '@/components/CodeSyntaxBlock.vue'
import FormInputField from '@/components/form/FormInputField.vue'
import FormRadioGroupField from '@/components/form/FormRadioGroupField.vue'
import FormSelectField from '@/components/form/FormSelectField.vue'
import HighlightThemeGallery from '@/features/component-library/HighlightThemeGallery.vue'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const props = defineProps<{ ctx: Record<string, any> }>()

const DEFAULT_FORM_SELECT_OPTIONS = [
  { label: 'Bug 修复', value: 'bugfix' },
  { label: '体验优化', value: 'ux' },
  { label: '技术重构', value: 'refactor' },
  { label: '实验功能', value: 'experiment' },
]

const DEFAULT_FORM_RADIO_OPTIONS = [
  { label: 'P0（阻塞）', value: 'p0' },
  { label: 'P1（高）', value: 'p1' },
  { label: 'P2（中）', value: 'p2' },
  { label: 'P3（低）', value: 'p3' },
]

const {
  activeProvider,
  componentSettingsSubMenu,
  isComponentLibraryMode,
  isComponentLibraryListMode,
  componentListMockItems,
  componentListDensity,
  componentListTone,
  componentListPreviewCount,
  componentListAsCards,
  componentListStriped,
  componentListBordered,
  componentListRounded,
  componentListHoverable,
  componentListShowDividers,
  componentListShowAvatar,
  componentListShowDescription,
  componentListShowMeta,
  componentListShowTags,
  componentListShowProgress,
  componentListShowActions,
  componentListPreviewClass,
  componentListPreviewItems,
  componentListActiveId,
  getComponentListStatusLabel,
  isComponentLibraryModalMode,
  componentModalMockFields,
  componentModalSize,
  componentModalTone,
  componentModalCompact,
  componentModalShowDivider,
  componentModalShowFooter,
  componentModalPreviewOpen,
  componentModalSurfaceClass,
  isComponentModalFieldCopyable,
  copyComponentModalFieldValue,
  componentModalCopiedFieldId,
  componentModalDialogClass,
  isComponentLibraryConfirmMode,
  componentConfirmMockCases,
  componentConfirmTone,
  componentConfirmShowDescription,
  componentConfirmRequireInput,
  componentConfirmKeyword,
  componentConfirmInput,
  isComponentConfirmSubmitDisabled,
  componentConfirmLoading,
  componentConfirmPreviewOpen,
  componentConfirmSurfaceClass,
  runComponentConfirmSubmit,
  isComponentLibraryFormMode,
  componentFormLayout,
  componentFormRadioDirection,
  componentFormDisabled,
  componentFormReadonly,
  componentFormShowHint,
  componentFormSimulateError,
  componentFormInputValue,
  componentFormSelectValue,
  componentFormRadioValue,
  componentFormSelectOptions,
  componentFormRadioOptions,
  componentFormSurfaceClass,
  componentFormInputHint,
  componentFormSelectHint,
  componentFormRadioHint,
  resetComponentFormPreview,
  isComponentLibraryIconMode,
  componentIconKeyword,
  componentIconItems,
  componentIconFilteredItems,
  componentIconUsedItems,
  componentIconUnusedItems,
  isComponentLibraryToastMode,
  componentToastMockItems,
  componentToastPosition,
  componentToastDurationMs,
  componentToastShowIcon,
  componentToastDense,
  componentToastSticky,
  clearComponentToastQueue,
  triggerComponentToast,
  componentToastStackClass,
  componentToastPreviewRuntimeItems,
  isRuntimeComponentToast,
  removeComponentToast,
} = props.ctx

const isComponentLibraryModeResolved = computed(() => {
  const mode = unref(isComponentLibraryMode)
  return Boolean(mode) || unref(activeProvider) === 'component-library'
})

const componentSubMenuResolved = computed<'list' | 'modal' | 'confirm' | 'toast' | 'form' | 'icon'>(() => {
  const raw = String(unref(componentSettingsSubMenu) || '').trim().toLowerCase()
  if (raw === 'list' || raw === 'modal' || raw === 'confirm' || raw === 'toast' || raw === 'form' || raw === 'icon') {
    return raw
  }
  if (Boolean(unref(isComponentLibraryFormMode))) return 'form'
  if (Boolean(unref(isComponentLibraryIconMode))) return 'icon'
  if (Boolean(unref(isComponentLibraryToastMode))) return 'toast'
  if (Boolean(unref(isComponentLibraryConfirmMode))) return 'confirm'
  if (Boolean(unref(isComponentLibraryModalMode))) return 'modal'
  if (Boolean(unref(isComponentLibraryListMode))) return 'list'
  return 'list'
})

const isComponentLibraryFormModeResolved = computed(() => {
  const mode = unref(isComponentLibraryFormMode)
  return Boolean(mode) || (isComponentLibraryModeResolved.value && componentSubMenuResolved.value === 'form')
})

const componentFormSelectOptionsSafe = computed(() => {
  const source = unref(componentFormSelectOptions)
  return Array.isArray(source) && source.length ? source : DEFAULT_FORM_SELECT_OPTIONS
})

const componentFormRadioOptionsSafe = computed(() => {
  const source = unref(componentFormRadioOptions)
  return Array.isArray(source) && source.length ? source : DEFAULT_FORM_RADIO_OPTIONS
})

const componentLibraryOverview = computed(() => {
  const subMenu = componentSubMenuResolved.value
  const listItems = unref(componentListMockItems) || []
  const modalFields = unref(componentModalMockFields) || []
  const confirmCases = unref(componentConfirmMockCases) || []
  const toastItems = unref(componentToastMockItems) || []
  const iconItems = unref(componentIconItems) || []
  const iconUsedItems = unref(componentIconUsedItems) || []
  const iconUnusedItems = unref(componentIconUnusedItems) || []

  if (subMenu === 'modal') {
    return {
      title: 'Modal 组件',
      description: '把业务弹窗的标题、字段、动作和代码片段展示沉淀成可复用模板。',
      primaryValue: modalFields.length,
      primaryLabel: '字段类型',
      secondaryValue: unref(componentModalShowFooter) ? '显示' : '隐藏',
      secondaryLabel: 'Footer',
      tertiaryValue: String(unref(componentModalTone) || 'default'),
      tertiaryLabel: '语气',
    }
  }

  if (subMenu === 'confirm') {
    return {
      title: 'Confirm 组件',
      description: '校准高风险确认、输入校验和处理中状态，避免危险操作显得太随意。',
      primaryValue: confirmCases.length,
      primaryLabel: '覆盖场景',
      secondaryValue: unref(componentConfirmRequireInput) ? '需要' : '无需',
      secondaryLabel: '输入确认',
      tertiaryValue: String(unref(componentConfirmTone) || 'default'),
      tertiaryLabel: '语气',
    }
  }

  if (subMenu === 'toast') {
    return {
      title: 'Toast 组件',
      description: '统一通知堆叠、密度和语气，让短反馈不打断工作流。',
      primaryValue: toastItems.length,
      primaryLabel: '通知类型',
      secondaryValue: unref(componentToastSticky) ? '常驻' : `${unref(componentToastDurationMs)}ms`,
      secondaryLabel: '关闭策略',
      tertiaryValue: String(unref(componentToastPosition) || 'top-right'),
      tertiaryLabel: '位置',
    }
  }

  if (subMenu === 'form') {
    return {
      title: 'Form 组件',
      description: '统一输入、选择和单选控件的布局、提示、禁用与校验反馈。',
      primaryValue: 3,
      primaryLabel: '核心字段',
      secondaryValue: componentFormSelectOptionsSafe.value.length,
      secondaryLabel: 'Select 项',
      tertiaryValue: componentFormRadioOptionsSafe.value.length,
      tertiaryLabel: 'Radio 项',
    }
  }

  if (subMenu === 'icon') {
    return {
      title: 'Icon 库',
      description: '按引用状态盘点项目内图标，优先复用已有资产，减少视觉噪声。',
      primaryValue: iconItems.length,
      primaryLabel: '图标总数',
      secondaryValue: iconUsedItems.length,
      secondaryLabel: '已引用',
      tertiaryValue: iconUnusedItems.length,
      tertiaryLabel: '未引用',
    }
  }

  return {
    title: 'List 组件',
    description: '把列表密度、卡片化、标签、进度和操作区抽成可调预览。',
    primaryValue: listItems.length,
    primaryLabel: 'Mock 项',
    secondaryValue: unref(componentListPreviewCount),
    secondaryLabel: '预览条数',
    tertiaryValue: unref(componentListAsCards) ? '卡片' : '列表',
    tertiaryLabel: '结构',
  }
})

function getModalFieldLanguage(kind: string) {
  if (kind === 'json') return 'json'
  if (kind === 'code') return 'typescript'
  return 'auto'
}
</script>

<template>
          <div class="component-library-panel" v-if="isComponentLibraryModeResolved">
            <section class="component-library-overview" :data-mode="componentSubMenuResolved">
              <div class="component-library-overview-copy">
                <small>组件设置</small>
                <h2>{{ componentLibraryOverview.title }}</h2>
                <p>{{ componentLibraryOverview.description }}</p>
              </div>
              <div class="component-library-overview-stats">
                <article>
                  <strong>{{ componentLibraryOverview.primaryValue }}</strong>
                  <small>{{ componentLibraryOverview.primaryLabel }}</small>
                </article>
                <article>
                  <strong>{{ componentLibraryOverview.secondaryValue }}</strong>
                  <small>{{ componentLibraryOverview.secondaryLabel }}</small>
                </article>
                <article>
                  <strong>{{ componentLibraryOverview.tertiaryValue }}</strong>
                  <small>{{ componentLibraryOverview.tertiaryLabel }}</small>
                </article>
              </div>
            </section>

            <template v-if="componentSubMenuResolved === 'list'">
            <section class="component-library-head">
              <div>
                <h3>List 组件预览</h3>
                <small>通过控件实时微调样式，下方 mock 数据覆盖常见与边界场景。</small>
              </div>
              <p class="component-library-meta">Mock 项：{{ componentListMockItems.length }}</p>
            </section>

            <section class="component-library-controls">
              <label>
                <small>密度</small>
                <select class="app-select" v-model="componentListDensity">
                  <option value="compact">紧凑</option>
                  <option value="default">标准</option>
                  <option value="comfortable">舒展</option>
                </select>
              </label>
              <label>
                <small>视觉层级</small>
                <select class="app-select" v-model="componentListTone">
                  <option value="default">默认</option>
                  <option value="soft">柔和</option>
                  <option value="strong">强调</option>
                </select>
              </label>
              <label>
                <small>预览条数</small>
                <input class="app-input" v-model.number="componentListPreviewCount" type="number" min="1" :max="componentListMockItems.length" />
              </label>
              <label class="component-switch"><input class="app-input" v-model="componentListAsCards" type="checkbox" />卡片化</label>
              <label class="component-switch"><input class="app-input" v-model="componentListStriped" type="checkbox" />斑马纹</label>
              <label class="component-switch"><input class="app-input" v-model="componentListBordered" type="checkbox" />描边</label>
              <label class="component-switch"><input class="app-input" v-model="componentListRounded" type="checkbox" />圆角</label>
              <label class="component-switch"><input class="app-input" v-model="componentListHoverable" type="checkbox" />悬停反馈</label>
              <label class="component-switch"><input class="app-input" v-model="componentListShowDividers" type="checkbox" />分割线</label>
              <label class="component-switch"><input class="app-input" v-model="componentListShowAvatar" type="checkbox" />头像区</label>
              <label class="component-switch"><input class="app-input" v-model="componentListShowDescription" type="checkbox" />描述</label>
              <label class="component-switch"><input class="app-input" v-model="componentListShowMeta" type="checkbox" />元信息</label>
              <label class="component-switch"><input class="app-input" v-model="componentListShowTags" type="checkbox" />标签</label>
              <label class="component-switch"><input class="app-input" v-model="componentListShowProgress" type="checkbox" />进度条</label>
              <label class="component-switch"><input class="app-input" v-model="componentListShowActions" type="checkbox" />操作区</label>
            </section>

            <section class="component-library-preview">
              <header>
                <strong>可调预览</strong>
                <small>点击列表项可查看 active 状态</small>
              </header>
              <ul class="component-list-preview" :class="componentListPreviewClass">
                <li
                  v-for="item in componentListPreviewItems"
                  :key="`preview-${item.id}`"
                  class="component-list-item"
                  :class="{ active: componentListActiveId === item.id, disabled: item.disabled }"
                  @click="!item.disabled && (componentListActiveId = item.id)"
                >
                  <div class="component-list-leading" v-if="componentListShowAvatar">
                    <span class="component-list-avatar" :data-tone="item.tone">{{ item.avatarText }}</span>
                  </div>
                  <div class="component-list-main">
                    <div class="component-list-top">
                      <strong :title="item.title">{{ item.title }}</strong>
                      <div class="component-list-flags">
                        <span class="component-list-status" :data-tone="item.tone">{{ getComponentListStatusLabel(item.tone) }}</span>
                        <span class="component-list-flag" v-if="item.pinned">置顶</span>
                        <span class="component-list-flag warn" v-if="item.soonDue">临近截止</span>
                      </div>
                    </div>
                    <p class="component-list-subtitle">{{ item.subtitle }}</p>
                    <p class="component-list-desc" v-if="componentListShowDescription && item.description">{{ item.description }}</p>
                    <div class="component-list-tags" v-if="componentListShowTags && item.tags.length">
                      <span v-for="tag in item.tags" :key="`${item.id}-${tag}`">{{ tag }}</span>
                    </div>
                    <div class="component-list-meta" v-if="componentListShowMeta || componentListShowProgress">
                      <small v-if="componentListShowMeta">Owner: {{ item.owner }} · 更新于 {{ item.updatedAt }}</small>
                      <div class="component-list-progress" v-if="componentListShowProgress">
                        <div class="component-list-progress-bar" :style="{ width: `${Math.max(0, Math.min(100, item.progress))}%` }" />
                      </div>
                    </div>
                  </div>
                  <div class="component-list-actions" v-if="componentListShowActions">
                    <button type="button" class="app-btn-ghost" :disabled="item.disabled">详情</button>
                    <button type="button" class="app-btn-ghost" :disabled="item.disabled">编辑</button>
                  </div>
                </li>
              </ul>
            </section>

            <section class="component-library-gallery">
              <article class="component-gallery-card">
                <h4>紧凑样式</h4>
                <ul class="component-list-preview component-list-preview--compact component-list-preview--striped component-list-preview--bordered component-list-preview--rounded">
                  <li v-for="item in componentListMockItems.slice(0, 4)" :key="`compact-${item.id}`" class="component-list-item">
                    <div class="component-list-main">
                      <div class="component-list-top">
                        <strong>{{ item.title }}</strong>
                        <span class="component-list-status" :data-tone="item.tone">{{ getComponentListStatusLabel(item.tone) }}</span>
                      </div>
                      <small class="component-list-subtitle">{{ item.owner }} · {{ item.updatedAt }}</small>
                    </div>
                  </li>
                </ul>
              </article>

              <article class="component-gallery-card">
                <h4>卡片样式</h4>
                <ul class="component-list-preview component-list-preview--cards component-list-preview--bordered component-list-preview--rounded component-list-preview--tone-soft">
                  <li v-for="item in componentListMockItems.slice(2, 6)" :key="`card-${item.id}`" class="component-list-item">
                    <div class="component-list-leading">
                      <span class="component-list-avatar" :data-tone="item.tone">{{ item.avatarText }}</span>
                    </div>
                    <div class="component-list-main">
                      <div class="component-list-top">
                        <strong>{{ item.title }}</strong>
                        <span class="component-list-status" :data-tone="item.tone">{{ getComponentListStatusLabel(item.tone) }}</span>
                      </div>
                      <p class="component-list-desc">{{ item.description || '无描述' }}</p>
                    </div>
                  </li>
                </ul>
              </article>

              <article class="component-gallery-card">
                <h4>空状态</h4>
                <div class="component-list-empty">暂无数据，请先创建一个 List Item。</div>
              </article>

              <article class="component-gallery-card">
                <h4>加载状态</h4>
                <div class="component-list-skeleton" v-for="i in 3" :key="`skeleton-${i}`">
                  <div class="component-list-skeleton-avatar" />
                  <div class="component-list-skeleton-lines">
                    <span />
                    <span />
                  </div>
                </div>
              </article>
            </section>
            </template>
            <template v-else-if="componentSubMenuResolved === 'modal'">
              <section class="component-library-head">
                <div>
                  <h3>Modal 组件预览</h3>
                  <small>覆盖尺寸、语气、字段类型与状态组合，便于快速复用业务弹窗结构。</small>
                </div>
                <p class="component-library-meta">Mock 字段：{{ componentModalMockFields.length }}</p>
              </section>

              <section class="component-library-controls">
                <label>
                  <small>尺寸</small>
                  <select class="app-select" v-model="componentModalSize">
                    <option value="sm">紧凑</option>
                    <option value="md">标准</option>
                    <option value="lg">宽版</option>
                  </select>
                </label>
                <label>
                  <small>语气</small>
                  <select class="app-select" v-model="componentModalTone">
                    <option value="default">默认</option>
                    <option value="info">信息提示</option>
                    <option value="warning">风险提醒</option>
                    <option value="danger">高风险</option>
                  </select>
                </label>
                <label class="component-switch"><input class="app-input" v-model="componentModalCompact" type="checkbox" />紧凑字段</label>
                <label class="component-switch"><input class="app-input" v-model="componentModalShowDivider" type="checkbox" />字段分割线</label>
                <label class="component-switch"><input class="app-input" v-model="componentModalShowFooter" type="checkbox" />显示 Footer</label>
              </section>

              <section class="component-library-preview">
                <header>
                  <strong>可调预览</strong>
                  <button type="button" class="app-btn-ghost" @click="componentModalPreviewOpen = true">打开 Modal 预览</button>
                </header>
                <article :class="componentModalSurfaceClass">
                  <div class="component-modal-head">
                    <div>
                      <h4>缺陷处理确认</h4>
                      <small>本弹窗用于换绑与字段核对，演示多字段组合展示。</small>
                    </div>
                    <span class="component-list-status" data-tone="warning">待确认</span>
                  </div>
                  <div class="component-modal-field-grid" :class="{ compact: componentModalCompact }">
                    <article
                      v-for="field in componentModalMockFields"
                      :key="`inline-${field.id}`"
                      class="component-modal-field"
                      :class="{ divider: componentModalShowDivider }"
                      :data-kind="field.kind"
                    >
                      <div class="component-modal-field-label-row">
                        <small>{{ field.label }}</small>
                        <button
                          v-if="isComponentModalFieldCopyable(field)"
                          type="button"
                          class="component-modal-copy-btn"
                          :title="`复制 ${field.label}`"
                          :aria-label="`复制 ${field.label}`"
                          @click.stop="copyComponentModalFieldValue(field)"
                        >
                          <IconCheck v-if="componentModalCopiedFieldId === field.id" :size="12" />
                          <IconCopy v-else :size="12" />
                        </button>
                      </div>
                      <div class="component-modal-field-value">
                        <template v-if="field.kind === 'tags'">
                          <span class="component-modal-token" v-for="tag in field.tags || []" :key="`${field.id}-${tag}`">{{ tag }}</span>
                        </template>
                        <a v-else-if="field.kind === 'link'" :href="field.href || '#'" target="_blank" rel="noopener noreferrer">
                          {{ field.value || '-' }}
                        </a>
                        <CodeSyntaxBlock
                          v-else-if="field.kind === 'code' || field.kind === 'json'"
                          :code="field.value || '-'"
                          :default-language="getModalFieldLanguage(field.kind)"
                          max-height="220px"
                        />
                        <code v-else-if="field.kind === 'path'">{{ field.value || '-' }}</code>
                        <span v-else-if="field.kind === 'boolean'" class="component-modal-bool" :data-checked="field.boolValue ? 'true' : 'false'">
                          {{ field.boolValue ? '是' : '否' }}
                        </span>
                        <p v-else-if="field.kind === 'multiline'">{{ field.value || '-' }}</p>
                        <span v-else>{{ field.value || '-' }}</span>
                      </div>
                    </article>
                  </div>
                  <footer v-if="componentModalShowFooter" class="component-modal-actions">
                    <button type="button" class="app-btn-ghost">取消</button>
                    <button class="app-btn" type="button">确认处理</button>
                  </footer>
                </article>
              </section>

              <section class="component-library-gallery">
                <article class="component-gallery-card">
                  <h4>字段覆盖</h4>
                  <div class="component-modal-type-grid">
                    <article class="component-modal-type-item" data-kind="text">
                      <small>文本</small>
                      <span>缺陷标题示例</span>
                    </article>
                    <article class="component-modal-type-item" data-kind="multiline">
                      <small>多行</small>
                      <span>多步骤复现说明</span>
                    </article>
                    <article class="component-modal-type-item" data-kind="tags">
                      <small>标签</small>
                      <span>回归测试 / Android</span>
                    </article>
                    <article class="component-modal-type-item" data-kind="datetime">
                      <small>时间</small>
                      <span>2026-04-01 10:42:19</span>
                    </article>
                    <article class="component-modal-type-item" data-kind="link">
                      <small>链接</small>
                      <span>REQ-4019 订单详情改版</span>
                    </article>
                    <article class="component-modal-type-item" data-kind="path">
                      <small>路径</small>
                      <span>/src/modules/order/detail/confirm-flow.ts</span>
                    </article>
                    <article class="component-modal-type-item" data-kind="boolean">
                      <small>布尔</small>
                      <span>是 / 否</span>
                    </article>
                    <article class="component-modal-type-item" data-kind="code">
                      <small>代码</small>
                      <span>if (!snapshot?.ready) return ...</span>
                    </article>
                    <article class="component-modal-type-item" data-kind="json">
                      <small>JSON</small>
                      <span>{ traceId, build, owner }</span>
                    </article>
                  </div>
                </article>
                <article class="component-gallery-card">
                  <h4>空状态</h4>
                  <div class="component-modal-empty">暂无字段，请先配置展示项。</div>
                </article>
                <article class="component-gallery-card">
                  <h4>加载状态</h4>
                  <div class="component-modal-skeleton" v-for="i in 3" :key="`modal-skeleton-${i}`">
                    <span />
                    <span />
                  </div>
                </article>
                <article class="component-gallery-card">
                  <h4>异常提示</h4>
                  <p class="component-modal-error">字段读取失败，请检查数据源映射与权限配置。</p>
                </article>
              </section>

              <HighlightThemeGallery current-theme-id="github-dark-dimmed" />

              <Dialog :open="componentModalPreviewOpen" @update:open="(open) => (componentModalPreviewOpen = open)">
                <DialogContent :class="componentModalDialogClass" :show-close="false">
                  <DialogHeader class="component-modal-dialog-header">
                    <div class="component-modal-dialog-title-row">
                      <div>
                        <DialogTitle>缺陷处理确认</DialogTitle>
                        <DialogDescription>预览各种字段展示方式，确保真实业务场景可直接复用。</DialogDescription>
                      </div>
                      <DialogClose as-child>
                        <button type="button" class="app-btn-ghost modal-close-btn" aria-label="关闭预览">×</button>
                      </DialogClose>
                    </div>
                  </DialogHeader>
                  <div class="component-modal-dialog-body">
                    <div class="component-modal-field-grid" :class="{ compact: componentModalCompact }">
                      <article
                        v-for="field in componentModalMockFields"
                        :key="`dialog-${field.id}`"
                        class="component-modal-field"
                        :class="{ divider: componentModalShowDivider }"
                        :data-kind="field.kind"
                      >
                        <div class="component-modal-field-label-row">
                          <small>{{ field.label }}</small>
                          <button
                            v-if="isComponentModalFieldCopyable(field)"
                            type="button"
                            class="component-modal-copy-btn"
                            :title="`复制 ${field.label}`"
                            :aria-label="`复制 ${field.label}`"
                            @click.stop="copyComponentModalFieldValue(field)"
                          >
                            <IconCheck v-if="componentModalCopiedFieldId === field.id" :size="12" />
                            <IconCopy v-else :size="12" />
                          </button>
                        </div>
                        <div class="component-modal-field-value">
                          <template v-if="field.kind === 'tags'">
                            <span class="component-modal-token" v-for="tag in field.tags || []" :key="`dialog-${field.id}-${tag}`">{{ tag }}</span>
                          </template>
                          <a v-else-if="field.kind === 'link'" :href="field.href || '#'" target="_blank" rel="noopener noreferrer">
                            {{ field.value || '-' }}
                          </a>
                          <CodeSyntaxBlock
                            v-else-if="field.kind === 'code' || field.kind === 'json'"
                            :code="field.value || '-'"
                            :default-language="getModalFieldLanguage(field.kind)"
                            max-height="220px"
                          />
                          <code v-else-if="field.kind === 'path'">{{ field.value || '-' }}</code>
                          <span v-else-if="field.kind === 'boolean'" class="component-modal-bool" :data-checked="field.boolValue ? 'true' : 'false'">
                            {{ field.boolValue ? '是' : '否' }}
                          </span>
                          <p v-else-if="field.kind === 'multiline'">{{ field.value || '-' }}</p>
                          <span v-else>{{ field.value || '-' }}</span>
                        </div>
                      </article>
                    </div>
                  </div>
                  <footer v-if="componentModalShowFooter" class="component-modal-actions">
                    <button type="button" class="app-btn-ghost" @click="componentModalPreviewOpen = false">取消</button>
                    <button class="app-btn" type="button">确认处理</button>
                  </footer>
                </DialogContent>
              </Dialog>
            </template>
            <template v-else-if="componentSubMenuResolved === 'confirm'">
              <section class="component-library-head">
                <div>
                  <h3>Confirm 组件预览</h3>
                  <small>覆盖默认确认、风险确认、输入校验和处理中状态。</small>
                </div>
                <p class="component-library-meta">Mock 场景：{{ componentConfirmMockCases.length }}</p>
              </section>

              <section class="component-library-controls">
                <label>
                  <small>语气</small>
                  <select class="app-select" v-model="componentConfirmTone">
                    <option value="default">默认</option>
                    <option value="warning">风险提醒</option>
                    <option value="danger">危险操作</option>
                    <option value="success">完成确认</option>
                  </select>
                </label>
                <label class="component-switch"><input class="app-input" v-model="componentConfirmShowDescription" type="checkbox" />描述文案</label>
                <label class="component-switch"><input class="app-input" v-model="componentConfirmRequireInput" type="checkbox" />输入确认</label>
                <label>
                  <small>确认关键字</small>
                  <input class="app-input" v-model="componentConfirmKeyword" type="text" placeholder="例如 DELETE" />
                </label>
              </section>

              <section class="component-library-preview component-library-preview--confirm">
                <header>
                  <strong>可调预览</strong>
                  <button type="button" class="app-btn-ghost" @click="componentConfirmPreviewOpen = true">打开 Confirm 预览</button>
                </header>
                <article :class="componentConfirmSurfaceClass">
                  <div class="component-confirm-head">
                    <h4>确认执行该操作？</h4>
                    <span class="component-confirm-tone" :data-tone="componentConfirmTone">{{ componentConfirmTone }}</span>
                  </div>
                  <p v-if="componentConfirmShowDescription" class="component-confirm-desc">
                    此操作将影响 6 条记录，执行后会写入审计日志并通知负责人。
                  </p>
                  <div class="component-confirm-field-list">
                    <div class="component-confirm-field">
                      <small>影响范围</small>
                      <span>排期 / 缺陷 / 绑定关系</span>
                    </div>
                    <div class="component-confirm-field">
                      <small>执行人</small>
                      <span>当前登录用户</span>
                    </div>
                    <div class="component-confirm-field">
                      <small>预计耗时</small>
                      <span>约 3-8 秒</span>
                    </div>
                  </div>
                  <label class="component-confirm-input" v-if="componentConfirmRequireInput">
                    <small>请输入 {{ componentConfirmKeyword || '关键字' }} 以确认</small>
                    <input class="app-input" v-model="componentConfirmInput" type="text" :placeholder="`输入 ${componentConfirmKeyword || '关键字'}`" />
                  </label>
                  <footer class="component-confirm-actions">
                    <button type="button" class="app-btn-ghost">取消</button>
                    <button class="app-btn" type="button" :disabled="isComponentConfirmSubmitDisabled() || componentConfirmLoading">
                      {{ componentConfirmLoading ? '处理中...' : '确认执行' }}
                    </button>
                  </footer>
                </article>
              </section>

              <section class="component-library-gallery">
                <article class="component-gallery-card">
                  <h4>场景覆盖</h4>
                  <div class="component-confirm-case-list">
                    <article class="component-confirm-case" v-for="item in componentConfirmMockCases" :key="item.id" :data-tone="item.tone">
                      <div class="component-confirm-case-head">
                        <strong>{{ item.title }}</strong>
                        <span class="component-confirm-tone" :data-tone="item.tone">{{ item.tone }}</span>
                      </div>
                      <p>{{ item.description }}</p>
                      <small v-if="item.requiresInput">{{ item.inputHint }}</small>
                      <div class="component-confirm-case-actions">
                        <button type="button" class="app-btn-ghost" disabled>{{ item.cancelLabel }}</button>
                        <button class="app-btn" type="button" :disabled="item.loading">{{ item.loading ? '处理中...' : item.confirmLabel }}</button>
                      </div>
                    </article>
                  </div>
                </article>
              </section>

              <Dialog :open="componentConfirmPreviewOpen" @update:open="(open) => (componentConfirmPreviewOpen = open)">
                <DialogContent :class="['component-confirm-dialog', 'component-confirm-dialog--preview', `component-confirm-dialog--tone-${componentConfirmTone}`]" :show-close="false">
                  <div class="component-confirm-head">
                    <h4>确认执行该操作？</h4>
                    <span class="component-confirm-tone" :data-tone="componentConfirmTone">{{ componentConfirmTone }}</span>
                  </div>
                  <p v-if="componentConfirmShowDescription" class="component-confirm-desc">
                    执行后会变更线上配置，请确认当前窗口和发布单一致。
                  </p>
                  <div class="component-confirm-field-list">
                    <div class="component-confirm-field">
                      <small>影响范围</small>
                      <span>排期 / 缺陷 / 绑定关系</span>
                    </div>
                    <div class="component-confirm-field">
                      <small>执行人</small>
                      <span>当前登录用户</span>
                    </div>
                    <div class="component-confirm-field">
                      <small>预计耗时</small>
                      <span>约 3-8 秒</span>
                    </div>
                  </div>
                  <label class="component-confirm-input" v-if="componentConfirmRequireInput">
                    <small>请输入 {{ componentConfirmKeyword || '关键字' }} 以确认</small>
                    <input class="app-input" v-model="componentConfirmInput" type="text" :placeholder="`输入 ${componentConfirmKeyword || '关键字'}`" />
                  </label>
                  <footer class="component-confirm-actions">
                    <button type="button" class="app-btn-ghost" @click="componentConfirmPreviewOpen = false">取消</button>
                    <button class="app-btn" type="button" :disabled="isComponentConfirmSubmitDisabled() || componentConfirmLoading" @click="runComponentConfirmSubmit">
                      {{ componentConfirmLoading ? '处理中...' : '确认执行' }}
                    </button>
                  </footer>
                </DialogContent>
              </Dialog>
            </template>
            <template v-else-if="componentSubMenuResolved === 'toast'">
              <section class="component-library-head">
                <div>
                  <h3>Toast 组件预览</h3>
                  <small>覆盖常见通知语气、布局密度、展示位置与自动关闭。</small>
                </div>
                <p class="component-library-meta">Mock 类型：{{ componentToastMockItems.length }}</p>
              </section>

              <section class="component-library-controls">
                <label>
                  <small>位置</small>
                  <select class="app-select" v-model="componentToastPosition">
                    <option value="top-right">右上</option>
                    <option value="top-center">顶部居中</option>
                    <option value="bottom-right">右下</option>
                  </select>
                </label>
                <label>
                  <small>自动关闭(ms)</small>
                  <input class="app-input" v-model.number="componentToastDurationMs" type="number" min="800" max="10000" step="100" />
                </label>
                <label class="component-switch"><input class="app-input" v-model="componentToastShowIcon" type="checkbox" />显示图标</label>
                <label class="component-switch"><input class="app-input" v-model="componentToastDense" type="checkbox" />紧凑模式</label>
                <label class="component-switch"><input class="app-input" v-model="componentToastSticky" type="checkbox" />默认常驻</label>
              </section>

              <section class="component-library-preview component-library-preview--toast">
                <header>
                  <strong>交互预览</strong>
                  <button type="button" class="app-btn-ghost" @click="clearComponentToastQueue">清空</button>
                </header>
                <div class="component-toast-trigger-row">
                  <button type="button" class="app-btn-ghost" @click="triggerComponentToast('default')">普通</button>
                  <button type="button" class="app-btn-ghost" @click="triggerComponentToast('info')">信息</button>
                  <button type="button" class="app-btn-ghost" @click="triggerComponentToast('success')">成功</button>
                  <button type="button" class="app-btn-ghost" @click="triggerComponentToast('warning')">警告</button>
                  <button type="button" class="app-btn-ghost" @click="triggerComponentToast('danger')">失败</button>
                  <button type="button" class="app-btn-ghost" @click="triggerComponentToast('loading')">处理中</button>
                </div>
                <div class="component-toast-preview-wrap">
                  <div :class="componentToastStackClass">
                    <article class="component-toast-item" v-for="item in componentToastPreviewRuntimeItems" :key="item.id" :data-tone="item.tone">
                      <div class="component-toast-main">
                        <span class="component-toast-icon" v-if="componentToastShowIcon">{{ item.tone.slice(0, 1).toUpperCase() }}</span>
                        <div class="component-toast-text">
                          <strong>{{ item.title }}</strong>
                          <p>{{ item.message }}</p>
                        </div>
                      </div>
                      <div class="component-toast-actions">
                        <button type="button" class="app-btn-ghost component-toast-action-btn" v-if="item.actionLabel">{{ item.actionLabel }}</button>
                        <button
                          type="button"
                          class="app-btn-ghost component-toast-close-btn"
                          v-if="isRuntimeComponentToast(item)"
                          @click="removeComponentToast(item.id)"
                        >
                          关闭
                        </button>
                        <span v-else class="component-toast-sample-tag">示例</span>
                      </div>
                    </article>
                  </div>
                </div>
              </section>

              <section class="component-library-gallery">
                <article class="component-gallery-card">
                  <h4>样式覆盖</h4>
                  <div class="component-toast-type-grid">
                    <article class="component-toast-item" v-for="item in componentToastMockItems" :key="`sample-${item.id}`" :data-tone="item.tone">
                      <div class="component-toast-main">
                        <span class="component-toast-icon" v-if="componentToastShowIcon">{{ item.tone.slice(0, 1).toUpperCase() }}</span>
                        <div class="component-toast-text">
                          <strong>{{ item.title }}</strong>
                          <p>{{ item.message }}</p>
                        </div>
                      </div>
                    </article>
                  </div>
                </article>
              </section>
            </template>
            <template v-else-if="componentSubMenuResolved === 'form' || isComponentLibraryFormModeResolved">
              <section class="component-library-head">
                <div>
                  <h3>Form 组件预览</h3>
                  <small>统一预览 Input / Select / Radio，覆盖布局、禁用、只读与校验态。</small>
                </div>
                <p class="component-library-meta">
                  字段 {{ 3 }} · Select {{ componentFormSelectOptionsSafe.length }} 项 · Radio {{ componentFormRadioOptionsSafe.length }} 项
                </p>
              </section>

              <section class="component-library-controls">
                <label>
                  <small>布局</small>
                  <select class="app-select" v-model="componentFormLayout">
                    <option value="stack">纵向</option>
                    <option value="inline">并排</option>
                  </select>
                </label>
                <label>
                  <small>Radio 排列</small>
                  <select class="app-select" v-model="componentFormRadioDirection">
                    <option value="row">横向</option>
                    <option value="column">纵向</option>
                  </select>
                </label>
                <label class="component-switch"><input class="app-input" v-model="componentFormDisabled" type="checkbox" />禁用全部</label>
                <label class="component-switch"><input class="app-input" v-model="componentFormReadonly" type="checkbox" />输入框只读</label>
                <label class="component-switch"><input class="app-input" v-model="componentFormShowHint" type="checkbox" />显示提示文案</label>
                <label class="component-switch"><input class="app-input" v-model="componentFormSimulateError" type="checkbox" />模拟输入错误</label>
              </section>

              <section class="component-library-preview component-library-preview--form">
                <header>
                  <strong>可调预览</strong>
                  <button type="button" class="app-btn-ghost" @click="resetComponentFormPreview">重置</button>
                </header>
                <article :class="componentFormSurfaceClass">
                  <div class="component-form-grid">
                    <FormInputField
                      v-model="componentFormInputValue"
                      label="需求标题"
                      placeholder="请输入标题"
                      :disabled="componentFormDisabled"
                      :readonly="componentFormReadonly"
                      :invalid="componentFormSimulateError"
                      :hint="componentFormInputHint"
                    />
                    <FormSelectField
                      v-model="componentFormSelectValue"
                      label="需求类型"
                      :options="componentFormSelectOptionsSafe"
                      :disabled="componentFormDisabled"
                      :hint="componentFormSelectHint"
                    />
                    <FormRadioGroupField
                      v-model="componentFormRadioValue"
                      label="优先级"
                      :options="componentFormRadioOptionsSafe"
                      :disabled="componentFormDisabled"
                      :direction="componentFormRadioDirection"
                      :hint="componentFormRadioHint"
                    />
                  </div>
                  <footer class="component-form-actions">
                    <button type="button" class="app-btn-ghost" :disabled="componentFormDisabled">取消</button>
                    <button type="button" class="app-btn" :disabled="componentFormDisabled || (componentFormSimulateError && !componentFormInputValue.trim())">
                      提交
                    </button>
                  </footer>
                </article>
              </section>

              <section class="component-library-gallery">
                <article class="component-gallery-card">
                  <h4>默认态</h4>
                  <div class="component-form-gallery">
                    <FormInputField model-value="缺陷回归验证" label="标题" hint="用于会话检索与列表展示" />
                    <FormSelectField model-value="bugfix" label="类型" :options="componentFormSelectOptionsSafe" />
                    <FormRadioGroupField model-value="p1" label="优先级" :options="componentFormRadioOptionsSafe" direction="row" />
                  </div>
                </article>
                <article class="component-gallery-card">
                  <h4>禁用态</h4>
                  <div class="component-form-gallery">
                    <FormInputField model-value="发布窗口冻结" label="标题" :disabled="true" />
                    <FormSelectField model-value="refactor" label="类型" :options="componentFormSelectOptionsSafe" :disabled="true" />
                    <FormRadioGroupField model-value="p2" label="优先级" :options="componentFormRadioOptionsSafe" :disabled="true" direction="column" />
                  </div>
                </article>
                <article class="component-gallery-card">
                  <h4>校验态</h4>
                  <div class="component-form-gallery">
                    <FormInputField model-value="" label="标题" :invalid="true" hint="标题不能为空" placeholder="请输入标题" />
                    <FormSelectField model-value="experiment" label="类型" :options="componentFormSelectOptionsSafe" hint="请选择最贴近的分类" />
                    <FormRadioGroupField model-value="p0" label="优先级" :options="componentFormRadioOptionsSafe" direction="row" hint="高优先级会触发额外提醒" />
                  </div>
                </article>
                <article class="component-gallery-card">
                  <h4>并排布局</h4>
                  <div class="component-form-gallery-inline">
                    <FormInputField model-value="订单页兼容性修复" label="标题" />
                    <FormSelectField model-value="ux" label="类型" :options="componentFormSelectOptionsSafe" />
                    <FormRadioGroupField model-value="p3" label="优先级" :options="componentFormRadioOptionsSafe" direction="row" />
                  </div>
                </article>
              </section>
            </template>
            <template v-else-if="componentSubMenuResolved === 'icon'">
              <section class="component-library-head">
                <div>
                  <h3>Icon 库预览</h3>
                  <small>按当前项目是否已引用分组，快速查看可复用图标。</small>
                </div>
                <p class="component-library-meta">
                  总数 {{ componentIconItems.length }} · 已用 {{ componentIconUsedItems.length }} · 未用 {{ componentIconUnusedItems.length }}
                </p>
              </section>

              <section class="component-library-controls">
                <label>
                  <small>搜索 Icon / 文件</small>
                  <input class="app-input" v-model="componentIconKeyword" type="text" placeholder="例如 IconCopy 或 AppToolbar.vue" />
                </label>
              </section>

              <section class="component-library-preview component-library-preview--icon">
                <header>
                  <strong>已使用（{{ componentIconUsedItems.length }}）</strong>
                  <small v-if="componentIconKeyword">筛选后总计 {{ componentIconFilteredItems.length }}</small>
                </header>
                <div class="component-icon-grid" v-if="componentIconUsedItems.length">
                  <article class="component-icon-card component-icon-card--used" v-for="item in componentIconUsedItems" :key="`used-${item.id}`">
                    <div class="component-icon-card-head">
                      <span class="component-icon-preview">
                        <component :is="item.component" :size="18" />
                      </span>
                      <div class="component-icon-meta">
                        <strong>{{ item.id }}</strong>
                        <small>{{ item.label }}</small>
                      </div>
                      <span class="component-icon-usage">引用 {{ item.usageCount }}</span>
                    </div>
                    <div class="component-icon-used-files">
                      <small v-for="file in item.usedBy" :key="`${item.id}-${file}`">{{ file }}</small>
                    </div>
                  </article>
                </div>
                <div class="component-list-empty" v-else>当前筛选条件下没有“已使用”图标。</div>
              </section>

              <section class="component-library-preview component-library-preview--icon">
                <header>
                  <strong>未使用（{{ componentIconUnusedItems.length }}）</strong>
                  <small>可优先复用这些图标，减少新依赖</small>
                </header>
                <div class="component-icon-grid" v-if="componentIconUnusedItems.length">
                  <article class="component-icon-card" v-for="item in componentIconUnusedItems" :key="`unused-${item.id}`">
                    <div class="component-icon-card-head">
                      <span class="component-icon-preview">
                        <component :is="item.component" :size="18" />
                      </span>
                      <div class="component-icon-meta">
                        <strong>{{ item.id }}</strong>
                        <small>{{ item.label }}</small>
                      </div>
                      <span class="component-icon-unused-tag">未引用</span>
                    </div>
                  </article>
                </div>
                <div class="component-list-empty" v-else>当前筛选条件下没有“未使用”图标。</div>
              </section>
            </template>
          </div>
</template>

<style scoped>
.component-library-panel {
  margin-top: 0.35rem;
  display: grid;
  gap: 0.82rem;
}

.component-library-overview {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: stretch;
  gap: 1rem;
  padding: 1.05rem;
  border: 1px solid var(--border-soft);
  border-radius: 0.75rem;
  background:
    radial-gradient(circle at 92% 0%, var(--accent-soft-bg), transparent 38%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018), transparent 58%),
    rgba(8, 15, 31, 0.64);
  box-shadow: var(--shadow-sm);
}

.component-library-overview::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.03), transparent 40%);
  opacity: 0.3;
}

.component-library-overview-copy,
.component-library-overview-stats {
  position: relative;
  z-index: 1;
}

.component-library-overview-copy {
  min-width: 0;
  display: grid;
  align-content: center;
  gap: 0.24rem;
}

.component-library-overview-copy small {
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.component-library-overview-copy h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: clamp(1.08rem, 1.6vw, 1.36rem);
  line-height: 1.15;
}

.component-library-overview-copy p {
  max-width: 42rem;
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
  line-height: 1.6;
}

.component-library-overview-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(6.4rem, 1fr));
  gap: 0.56rem;
}

.component-library-overview-stats article {
  min-height: 4.45rem;
  display: grid;
  align-content: center;
  gap: 0.16rem;
  padding: 0.65rem 0.72rem;
  border: 1px solid var(--border-soft);
  border-radius: 0.75rem;
  background: rgba(2, 6, 23, 0.28);
}

.component-library-overview-stats strong {
  color: var(--text-primary);
  font-size: 1.05rem;
  line-height: 1.1;
}

.component-library-overview-stats small {
  color: var(--text-muted);
  font-size: 0.68rem;
  line-height: 1.25;
}

.component-library-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.78rem 0.85rem;
  border: 1px solid var(--border-light);
  border-radius: 0.75rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), transparent 64%),
    rgba(8, 15, 31, 0.5);
}

.component-library-head h3 {
  margin: 0;
  font-size: 1rem;
  line-height: 1.3;
  color: var(--text-primary);
}

.component-library-head small {
  color: var(--text-muted);
  display: block;
  margin-top: 0.18rem;
  line-height: 1.45;
}

.component-library-meta {
  margin: 0;
  border: 1px solid var(--accent-ring);
  border-radius: 999px;
  background: var(--accent-soft-bg);
  color: var(--text-secondary);
  font-size: 0.72rem;
  line-height: 1.2;
  padding: 0.22rem 0.56rem;
  white-space: nowrap;
}

.component-library-controls {
  border: 1px solid var(--border-light);
  border-radius: 0.75rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.018), transparent 62%),
    rgba(8, 15, 31, 0.5);
  padding: 0.72rem;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(auto-fit, minmax(9.8rem, 1fr));
}

.component-library-controls label {
  display: grid;
  align-content: center;
  gap: 0.25rem;
  min-height: 2.1rem;
  color: var(--text-secondary);
}

.component-library-controls label small {
  color: var(--text-muted);
  font-size: 0.68rem;
}

.component-library-controls input[type='number'] {
  height: 2rem;
}

.component-switch {
  display: inline-flex !important;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid var(--border-soft);
  border-radius: 0.5rem;
  background: rgba(12, 25, 45, 0.42);
  padding: 0.36rem 0.5rem;
  font-size: 0.74rem;
  line-height: 1.2;
  transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
}

.component-switch:hover {
  border-color: var(--border-strong);
  background: rgba(18, 38, 66, 0.5);
  transform: translateY(-1px);
}

.component-switch input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent-primary);
}

.component-library-preview {
  border: 1px solid var(--border-light);
  border-radius: 0.75rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 58%),
    rgba(8, 15, 31, 0.46);
  padding: 0.78rem;
  display: grid;
  gap: 0.55rem;
  box-shadow: var(--shadow-sm);
}

.component-library-preview header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
  color: var(--text-secondary);
  min-width: 0;
}

.component-library-preview header strong {
  color: var(--text-primary);
  font-size: 0.84rem;
}

.component-library-preview header small {
  color: var(--text-muted);
  line-height: 1.35;
}

.component-library-preview header button {
  width: auto;
}

.component-library-preview--confirm {
  gap: 0.68rem;
  overflow: hidden;
}

.component-library-preview--toast {
  gap: 0.62rem;
}

.component-library-preview--form {
  gap: 0.66rem;
}

.component-library-gallery {
  display: grid;
  gap: 0.65rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.component-gallery-card {
  border: 1px solid var(--border-light);
  border-radius: 0.75rem;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 62%),
    rgba(8, 15, 31, 0.44);
  padding: 0.72rem;
  display: grid;
  gap: 0.5rem;
  min-width: 0;
}

.component-gallery-card h4 {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-primary);
}

.component-library-preview--icon {
  gap: 0.65rem;
}

.component-icon-grid {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.component-icon-card {
  border: 1px solid var(--border-soft);
  border-radius: 0.5rem;
  background: rgba(15, 23, 42, 0.36);
  padding: 0.5rem;
  display: grid;
  gap: 0.4rem;
}

.component-icon-card--used {
  border-color: var(--accent-ring);
  background: var(--accent-soft-bg);
}

.component-icon-card-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.component-icon-preview {
  width: 1.9rem;
  min-width: 1.9rem;
  height: 1.9rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border-soft);
  background: rgba(2, 6, 23, 0.56);
  color: var(--text-secondary);
  display: inline-grid;
  place-items: center;
}

.component-icon-meta {
  min-width: 0;
  display: grid;
  gap: 0.12rem;
}

.component-icon-meta strong {
  font-size: 0.78rem;
  color: var(--text-primary);
  line-height: 1.2;
}

.component-icon-meta small {
  font-size: 0.68rem;
  color: var(--text-muted);
  line-height: 1.2;
}

.component-icon-usage,
.component-icon-unused-tag {
  margin-left: auto;
  border-radius: 999px;
  border: 1px solid var(--border-soft);
  background: rgba(51, 65, 85, 0.24);
  color: var(--text-secondary);
  font-size: 0.64rem;
  line-height: 1.2;
  padding: 0.1rem 0.38rem;
  white-space: nowrap;
}

.component-icon-unused-tag {
  color: var(--text-secondary);
  border-color: var(--accent-ring);
  background: var(--accent-soft-bg);
}

.component-icon-used-files {
  display: grid;
  gap: 0.24rem;
}

.component-icon-used-files small {
  border: 1px dashed var(--border-soft);
  border-radius: 0.375rem;
  background: rgba(2, 6, 23, 0.38);
  color: var(--text-muted);
  font-size: 0.67rem;
  line-height: 1.3;
  padding: 0.16rem 0.34rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}


@media (max-width: 760px) {
  .component-library-overview-stats,
  .component-library-gallery,
  .component-icon-grid {
    grid-template-columns: 1fr;
  }

  .component-library-head,
  .component-library-preview header {
    display: grid;
  }

  .component-library-meta {
    width: fit-content;
  }
}

@media (max-width: 1200px) {
  .component-library-controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .component-library-gallery {
    grid-template-columns: 1fr;
  }
}
</style>
