<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'

type ModelSettingsSubMenu = 'management'

const props = defineProps<{
  menuOpen: boolean
  activeProvider: string
  modelSettingsSubMenu: ModelSettingsSubMenu
  onSelectMenu: (menu: ModelSettingsSubMenu) => void
}>()

const emit = defineEmits<{
  'update:menuOpen': [value: boolean]
}>()

function toggleMenu() {
  emit('update:menuOpen', !props.menuOpen)
}
</script>

<template>
  <div class="accordion-item">
    <button class="app-btn accordion-head app-btn-ghost" data-short-label="模型" @click="toggleMenu" type="button">
      <div class="accordion-title">
        <strong>模型配置</strong>
        <small>系统模型与能力链路</small>
      </div>
      <span class="accordion-toggle-icon" :class="{ open: menuOpen }">
        <ChevronDown :size="16" />
      </span>
    </button>

    <transition name="accordion">
      <div class="accordion-body" v-show="menuOpen">
        <div class="provider-list">
          <button
            type="button"
            class="provider-item"
            :class="{ active: activeProvider === 'model-settings' && modelSettingsSubMenu === 'management' }"
            @click="onSelectMenu('management')"
            title="模型管理"
          >
            <div class="provider-main">
              <span class="provider-badge" data-provider="model-settings">ML</span>
              <strong class="provider-label">模型管理</strong>
            </div>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>
