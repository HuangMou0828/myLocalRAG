<script setup lang="ts">
import { computed } from 'vue'
import { IconPanelLeftClose, IconPanelLeftOpen } from '@/components/icons/app-icons'
import BugLocatorMenu from '@/features/navigation/BugLocatorMenu.vue'
import ComponentSettingsMenu from '@/features/navigation/ComponentSettingsMenu.vue'
import FeishuMasterMenu from '@/features/navigation/FeishuMasterMenu.vue'
import KnowledgeSourcesMenu from '@/features/navigation/KnowledgeSourcesMenu.vue'
import ModelSettingsMenu from '@/features/navigation/ModelSettingsMenu.vue'
import ModelSourceMenu from '@/features/navigation/ModelSourceMenu.vue'
import type { AppSidebarConfig } from '@/features/app/appShellComponentConfigs'

const props = defineProps<{
  config: AppSidebarConfig
}>()

const config = computed(() => props.config)

function toggleSidebar() {
  config.value.actions.setCollapsed(!config.value.collapsed)
}

const isKnowledgeActive = computed(() => String(config.value.navigation.activeProvider || '').startsWith('knowledge-'))
const isBugActive = computed(() => config.value.navigation.activeProvider === 'bug-cursor')
const isFeishuActive = computed(() => config.value.navigation.activeProvider === 'feishu-master')
const isComponentActive = computed(() => config.value.navigation.activeProvider === 'component-library')
const isModelActive = computed(() => config.value.navigation.activeProvider === 'model-settings')
const isSessionActive = computed(() =>
  !isKnowledgeActive.value
  && !isBugActive.value
  && !isFeishuActive.value
  && !isComponentActive.value
  && !isModelActive.value,
)

function openCollapsedSessionRail() {
  config.value.actions.selectProvider(isSessionActive.value ? config.value.navigation.activeProvider || 'all' : 'all')
  config.value.actions.setMenuOpen('model', true)
}

function openCollapsedKnowledgeRail() {
  config.value.actions.selectProvider('knowledge-sources')
  config.value.actions.setMenuOpen('knowledge', true)
}

function openCollapsedBugRail() {
  config.value.actions.selectBugLocatorMenu('trace')
  config.value.actions.setMenuOpen('bug', true)
}

function openCollapsedFeishuRail() {
  config.value.actions.selectFeishuMasterMenu('schedule')
  config.value.actions.setMenuOpen('feishu', true)
}

function openCollapsedComponentRail() {
  config.value.actions.selectComponentSettingsMenu('list')
  config.value.actions.setMenuOpen('component', true)
}

function openCollapsedModelRail() {
  config.value.actions.selectModelSettingsMenu('management')
  config.value.actions.setMenuOpen('modelSettings', true)
}
</script>

<template>
  <aside class="panel sidebar">
    <div class="sidebar-brand">
      <div class="sidebar-brand-main">
        <div class="sidebar-brand-mark" aria-label="Memory Hub">
          <span>M</span>
          <span>H</span>
        </div>
        <div class="sidebar-brand-copy">
          <strong>Memory Hub</strong>
          <small>Multi-AI Session Hub</small>
        </div>
      </div>
      <button
        class="app-btn-ghost collapse-btn"
        type="button"
        @click="toggleSidebar"
        :title="config.collapsed ? '展开侧栏' : '收起侧栏'"
        :aria-label="config.collapsed ? '展开侧栏' : '收起侧栏'"
      >
        <IconPanelLeftOpen v-if="config.collapsed" :size="20" />
        <IconPanelLeftClose v-else :size="20" />
      </button>
    </div>

    <div class="head">
      <div class="head-row">
        <h2>工作台导航</h2>
        <span class="sidebar-status-badge" aria-hidden="true">Local</span>
      </div>
      <small>先选来源，再进入知识、复盘和系统工作流。</small>
    </div>

    <div v-if="config.collapsed" class="sidebar-collapsed-rail">
      <button type="button" class="sidebar-rail-item" :class="{ active: isSessionActive }" @click="openCollapsedSessionRail">
        <span class="sidebar-rail-label">会话</span>
      </button>
      <button type="button" class="sidebar-rail-item" :class="{ active: isKnowledgeActive }" @click="openCollapsedKnowledgeRail">
        <span class="sidebar-rail-label">知识</span>
      </button>
      <button type="button" class="sidebar-rail-item" :class="{ active: isBugActive }" @click="openCollapsedBugRail">
        <span class="sidebar-rail-label">缺陷</span>
      </button>
      <button type="button" class="sidebar-rail-item" :class="{ active: isFeishuActive }" @click="openCollapsedFeishuRail">
        <span class="sidebar-rail-label">飞书</span>
      </button>
      <button type="button" class="sidebar-rail-item" :class="{ active: isComponentActive }" @click="openCollapsedComponentRail">
        <span class="sidebar-rail-label">组件</span>
      </button>
      <button type="button" class="sidebar-rail-item" :class="{ active: isModelActive }" @click="openCollapsedModelRail">
        <span class="sidebar-rail-label">模型</span>
      </button>
    </div>

    <div v-else class="sidebar-nav-scroll">
      <section class="sidebar-nav-group">
        <p class="sidebar-group-label">Sessions</p>
        <ModelSourceMenu
          :menu-open="config.menus.model"
          :provider-sections="config.navigation.providerSections"
          :active-provider="config.navigation.activeProvider"
          :provider-logo-map="config.navigation.providerLogoMap"
          :on-select-provider="config.actions.selectProvider"
          @update:menu-open="(value) => config.actions.setMenuOpen('model', value)"
        />
      </section>

      <section class="sidebar-nav-group">
        <p class="sidebar-group-label">Review & Knowledge</p>
        <KnowledgeSourcesMenu
          :menu-open="config.menus.knowledge"
          :active-provider="config.navigation.activeProvider"
          :on-select="config.actions.selectProvider"
          @update:menu-open="(value) => config.actions.setMenuOpen('knowledge', value)"
        />

        <BugLocatorMenu
          :menu-open="config.menus.bug"
          :active-provider="config.navigation.activeProvider"
          :bug-trace-sub-menu="config.navigation.bugTraceSubMenu"
          :on-select-menu="config.actions.selectBugLocatorMenu"
          @update:menu-open="(value) => config.actions.setMenuOpen('bug', value)"
        />

        <FeishuMasterMenu
          :menu-open="config.menus.feishu"
          :active-provider="config.navigation.activeProvider"
          :feishu-master-sub-menu="config.navigation.feishuMasterSubMenu"
          :on-select-menu="config.actions.selectFeishuMasterMenu"
          @update:menu-open="(value) => config.actions.setMenuOpen('feishu', value)"
        />
      </section>

      <section class="sidebar-nav-group">
        <p class="sidebar-group-label">System & Components</p>
        <ComponentSettingsMenu
          :menu-open="config.menus.component"
          :active-provider="config.navigation.activeProvider"
          :component-settings-sub-menu="config.navigation.componentSettingsSubMenu"
          :on-select-menu="config.actions.selectComponentSettingsMenu"
          @update:menu-open="(value) => config.actions.setMenuOpen('component', value)"
        />

        <ModelSettingsMenu
          :menu-open="config.menus.modelSettings"
          :active-provider="config.navigation.activeProvider"
          :model-settings-sub-menu="config.navigation.modelSettingsSubMenu"
          :on-select-menu="config.actions.selectModelSettingsMenu"
          @update:menu-open="(value) => config.actions.setMenuOpen('modelSettings', value)"
        />
      </section>
    </div>
  </aside>
</template>
