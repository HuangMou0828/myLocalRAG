<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import AppSidebar from '@/features/app/components/AppSidebar.vue'
import AppToolbar from '@/features/app/components/AppToolbar.vue'
import SessionWorkspacePanel from '@/features/session/SessionWorkspacePanel.vue'
import { useAppShell } from '@/features/app/useAppShell'

const BugLocatorPanel = defineAsyncComponent(() => import('@/features/bug-trace/BugLocatorPanel.vue'))
const ComponentLibraryPanel = defineAsyncComponent(() => import('@/features/component-library/ComponentLibraryPanel.vue'))
const FeishuSchedulePanel = defineAsyncComponent(() => import('@/features/feishu-master/FeishuSchedulePanel.vue'))
const KnowledgeSourcesPanel = defineAsyncComponent(() => import('@/features/knowledge-sources/KnowledgeSourcesPanel.vue'))
const ModelManagementPanel = defineAsyncComponent(() => import('@/features/model-settings/ModelManagementPanel.vue'))
const AppOverlayModals = defineAsyncComponent(() => import('@/features/overlays/AppOverlayModals.vue'))

const {
  appSidebarConfig,
  appToolbarConfig,
  sidebarCollapsed,
  isBugLocatorMode,
  isBugTraceDomainReady,
  isKnowledgeSourcesMode,
  isSpecialMode,
  bugLocatorPanelCtx,
  componentLibraryPanelCtx,
  modelManagementPanelCtx,
  knowledgeSourcesPanelCtx,
  feishuSchedulePanelCtx,
  sessionWorkspaceCtx,
  overlayModalsCtx,
  shouldMountOverlayModals,
} = useAppShell()
</script>

<template>
  <div class="layout" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <AppSidebar :config="appSidebarConfig" />

    <main class="panel main" :class="{ 'main-bug-mode': isSpecialMode }">
      <AppToolbar :config="appToolbarConfig" />

      <template v-if="isSpecialMode">
        <section class="panel-soft bug-trace-panel">
          <BugLocatorPanel v-if="isBugTraceDomainReady" :ctx="bugLocatorPanelCtx" />
          <p v-else-if="isBugLocatorMode" class="warn">Bug Trace 模块加载中...</p>
          <ComponentLibraryPanel :ctx="componentLibraryPanelCtx" />
          <ModelManagementPanel :ctx="modelManagementPanelCtx" />
          <KnowledgeSourcesPanel v-if="isKnowledgeSourcesMode" :ctx="knowledgeSourcesPanelCtx" />
          <FeishuSchedulePanel :ctx="feishuSchedulePanelCtx" />
        </section>
      </template>

      <template v-else>
        <SessionWorkspacePanel :ctx="sessionWorkspaceCtx" />
      </template>
    </main>
  </div>

  <AppOverlayModals v-if="shouldMountOverlayModals" :ctx="overlayModalsCtx" />
</template>
