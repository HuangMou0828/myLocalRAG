<script setup lang="ts">
import { computed, unref, watch } from 'vue'

const props = defineProps<{ ctx: Record<string, any> }>()

const {
  activeProvider,
  isModelSettingsMode,
  modelSettingsLoading,
  modelSettingsSaving,
  modelManagementItems,
  loadModelSettings,
  openModelSettings,
} = props.ctx

const isModelSettingsModeResolved = computed(() => {
  const mode = unref(isModelSettingsMode)
  return Boolean(mode) || unref(activeProvider) === 'model-settings'
})

const modelManagementItemsResolved = computed(() => {
  const items = unref(modelManagementItems)
  return Array.isArray(items) ? items : []
})

const enabledModelCount = computed(() =>
  modelManagementItemsResolved.value.filter((item) => item.enabled).length,
)

const pendingModelCount = computed(() =>
  modelManagementItemsResolved.value.filter((item) => !item.enabled).length,
)

const modelCapabilityCoverageCount = computed(() => {
  const titles = modelManagementItemsResolved.value.flatMap((item) => item.capabilityTitles || [])
  return new Set(titles.filter(Boolean)).size
})

function getModelCardTone(ownerKeys: string[]) {
  if (ownerKeys.includes('embedding')) return 'info'
  if (ownerKeys.includes('dspy')) return 'warn'
  return 'success'
}

watch(
  () => isModelSettingsModeResolved.value,
  (isActive) => {
    if (!isActive) return
    void loadModelSettings()
  },
  { immediate: true },
)
</script>

<template>
  <section v-if="isModelSettingsModeResolved" class="model-management-panel">
    <div class="model-management-head">
      <div class="model-management-head-copy">
        <small>模型视角</small>
        <h2>模型管理</h2>
        <p>这里只展示系统当前正在使用的模型实例，以及它们分别承担哪些能力链路。</p>
      </div>
      <div class="model-management-head-actions">
        <button type="button" class="app-btn-ghost" @click="loadModelSettings" :disabled="modelSettingsLoading || modelSettingsSaving">
          {{ modelSettingsLoading ? '同步中...' : '同步信息' }}
        </button>
      </div>
    </div>

    <section class="model-management-overview">
      <article>
        <small>模型实例</small>
        <strong>{{ modelManagementItemsResolved.length }}</strong>
        <span>按模型名 / API Base / Key 合并展示</span>
      </article>
      <article>
        <small>已启用</small>
        <strong>{{ enabledModelCount }}</strong>
        <span>{{ pendingModelCount ? `${pendingModelCount} 个待补全` : '配置链路完整' }}</span>
      </article>
      <article>
        <small>职责覆盖</small>
        <strong>{{ modelCapabilityCoverageCount }}</strong>
        <span>生成 / 向量 / 优化能力归属</span>
      </article>
    </section>

    <div v-if="modelSettingsLoading" class="feishu-defect-skeleton-list model-management-skeleton-list">
      <div class="component-list-skeleton" v-for="i in 3" :key="`model-management-skeleton-${i}`">
        <div class="component-list-skeleton-avatar" />
        <div class="component-list-skeleton-lines">
          <span />
          <span />
        </div>
      </div>
    </div>

    <div v-else-if="!modelManagementItemsResolved.length" class="component-list-empty model-management-empty">
      还没有可用的模型配置，先点击“编辑配置”补充 Assistant / Embedding / DSPy 的模型信息。
    </div>

    <ul
      v-else
      class="component-list-preview component-list-preview--cards component-list-preview--bordered component-list-preview--rounded component-list-preview--tone-soft component-list-preview--hoverable feishu-defect-list model-management-list"
    >
      <li
        v-for="item in modelManagementItemsResolved"
        :key="item.id"
        class="component-list-item model-management-item"
      >
        <div class="component-list-leading">
          <span class="component-list-avatar" :data-tone="getModelCardTone(item.ownerKeys)">
            {{ item.avatarText }}
          </span>
        </div>
        <div class="component-list-main">
          <div class="component-list-top">
            <strong>{{ item.title }}</strong>
            <div class="component-list-flags">
              <span class="component-list-status" :data-tone="item.enabled ? 'success' : 'neutral'">
                {{ item.enabled ? '已启用' : '待补全' }}
              </span>
              <span
                v-for="owner in item.owners"
                :key="`${item.id}-${owner}`"
                class="model-management-role-chip"
              >
                {{ owner }}
              </span>
            </div>
          </div>
          <p class="component-list-subtitle">{{ item.subtitle }}</p>
          <p class="component-list-desc">{{ item.description }}</p>

          <div class="component-list-tags" v-if="item.configTags.length">
            <span v-for="tag in item.configTags" :key="`${item.id}-tag-${tag}`" class="model-management-meta-tag">
              {{ tag }}
            </span>
          </div>

          <div class="component-list-tags" v-if="item.paths.length">
            <span v-for="path in item.paths" :key="`${item.id}-path-${path}`" class="model-management-path-tag">
              {{ path }}
            </span>
          </div>

          <div class="component-list-tags" v-if="item.dueDateTags.length">
            <span v-for="tag in item.dueDateTags" :key="`${item.id}-due-${tag}`" class="model-management-deadline-tag">
              {{ tag }}
            </span>
          </div>

          <div class="component-list-actions">
            <button type="button" class="app-btn-ghost bug-inbox-detail-btn" @click="openModelSettings(item)">
              编辑配置
            </button>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>
