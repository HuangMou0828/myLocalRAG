<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'

type BugTraceSubMenu = 'trace' | 'inbox'

const props = defineProps<{
  menuOpen: boolean
  activeProvider: string
  bugTraceSubMenu: BugTraceSubMenu
  onSelectMenu: (menu: BugTraceSubMenu) => void
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
    <button class="app-btn accordion-head app-btn-ghost" data-short-label="缺陷" @click="toggleMenu" type="button">
      <div class="accordion-title">
        <strong>Bug定位</strong>
        <small>Patch 反查与缺陷入库</small>
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
            :class="{ active: activeProvider === 'bug-cursor' && bugTraceSubMenu === 'trace' }"
            @click="onSelectMenu('trace')"
            title="Bug Trace"
          >
            <div class="provider-main">
              <span class="provider-badge" data-provider="bug-cursor">CSR</span>
              <strong class="provider-label">Bug Trace</strong>
            </div>
          </button>
          <button
            type="button"
            class="provider-item"
            :class="{ active: activeProvider === 'bug-cursor' && bugTraceSubMenu === 'inbox' }"
            @click="onSelectMenu('inbox')"
            title="Bug Inbox"
          >
            <div class="provider-main">
              <span class="provider-badge" data-provider="bug-cursor">INB</span>
              <strong class="provider-label">Bug Inbox</strong>
            </div>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>
