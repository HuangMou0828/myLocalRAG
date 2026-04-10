<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'

type ComponentSettingsSubMenu = 'list' | 'modal' | 'confirm' | 'toast' | 'form' | 'icon'

const props = defineProps<{
  menuOpen: boolean
  activeProvider: string
  componentSettingsSubMenu: ComponentSettingsSubMenu
  onSelectMenu: (menu: ComponentSettingsSubMenu) => void
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
    <button class="app-btn accordion-head app-btn-ghost" data-short-label="组件" @click="toggleMenu" type="button">
      <div class="accordion-title">
        <strong>组件设置</strong>
        <small>组件基线与交互样例</small>
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
            :class="{ active: activeProvider === 'component-library' && componentSettingsSubMenu === 'list' }"
            @click="onSelectMenu('list')"
            title="List"
          >
            <div class="provider-main">
              <span class="provider-badge" data-provider="component-library">LST</span>
              <strong class="provider-label">List</strong>
            </div>
          </button>
          <button
            type="button"
            class="provider-item"
            :class="{ active: activeProvider === 'component-library' && componentSettingsSubMenu === 'modal' }"
            @click="onSelectMenu('modal')"
            title="Modal"
          >
            <div class="provider-main">
              <span class="provider-badge" data-provider="component-library">MDL</span>
              <strong class="provider-label">Modal</strong>
            </div>
          </button>
          <button
            type="button"
            class="provider-item"
            :class="{ active: activeProvider === 'component-library' && componentSettingsSubMenu === 'confirm' }"
            @click="onSelectMenu('confirm')"
            title="Confirm"
          >
            <div class="provider-main">
              <span class="provider-badge" data-provider="component-library">CNF</span>
              <strong class="provider-label">Confirm</strong>
            </div>
          </button>
          <button
            type="button"
            class="provider-item"
            :class="{ active: activeProvider === 'component-library' && componentSettingsSubMenu === 'toast' }"
            @click="onSelectMenu('toast')"
            title="Toast"
          >
            <div class="provider-main">
              <span class="provider-badge" data-provider="component-library">TST</span>
              <strong class="provider-label">Toast</strong>
            </div>
          </button>
          <button
            type="button"
            class="provider-item"
            :class="{ active: activeProvider === 'component-library' && componentSettingsSubMenu === 'form' }"
            @click="onSelectMenu('form')"
            title="Form"
          >
            <div class="provider-main">
              <span class="provider-badge" data-provider="component-library">FRM</span>
              <strong class="provider-label">Form</strong>
            </div>
          </button>
          <button
            type="button"
            class="provider-item"
            :class="{ active: activeProvider === 'component-library' && componentSettingsSubMenu === 'icon' }"
            @click="onSelectMenu('icon')"
            title="Icon"
          >
            <div class="provider-main">
              <span class="provider-badge" data-provider="component-library">ICN</span>
              <strong class="provider-label">Icon</strong>
            </div>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>
