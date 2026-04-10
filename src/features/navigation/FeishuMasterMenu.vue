<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'

type FeishuMasterSubMenu = 'schedule'

const props = defineProps<{
  menuOpen: boolean
  activeProvider: string
  feishuMasterSubMenu: FeishuMasterSubMenu
  onSelectMenu: (menu: FeishuMasterSubMenu) => void
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
    <button class="app-btn accordion-head app-btn-ghost" data-short-label="飞书" @click="toggleMenu" type="button">
      <div class="accordion-title">
        <strong>飞书大师</strong>
        <small>排期与缺陷协同</small>
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
            :class="{ active: activeProvider === 'feishu-master' && feishuMasterSubMenu === 'schedule' }"
            @click="onSelectMenu('schedule')"
            title="排期大师"
          >
            <div class="provider-main">
              <span class="provider-badge" data-provider="feishu-master">SCH</span>
              <strong class="provider-label">排期大师</strong>
            </div>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>
