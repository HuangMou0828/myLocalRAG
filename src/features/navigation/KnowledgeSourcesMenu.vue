<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'

const props = defineProps<{
  menuOpen: boolean
  activeProvider: string
  onSelect: (providerId: string) => void
}>()

const emit = defineEmits<{
  'update:menuOpen': [value: boolean]
}>()

const items = [
  { id: 'knowledge-sources', label: '知识采集', badge: '原料', title: '管理 capture / note / document 原始素材' },
  { id: 'knowledge-task-review', label: '任务筛选', badge: '筛选', title: '先按任务视角筛掉噪声和上下文碎片' },
  { id: 'knowledge-promotion-review', label: '升格审核', badge: '候选', title: '集中查看待升格 issue / pattern / synthesis 候选' },
  { id: 'knowledge-health', label: '健康巡检', badge: '巡检', title: '查看 lint、知识空洞和长期积压提醒' },
] as const

function toggleMenu() {
  emit('update:menuOpen', !props.menuOpen)
}
</script>

<template>
  <div class="accordion-item">
    <button class="app-btn accordion-head app-btn-ghost" data-short-label="知识" @click="toggleMenu" type="button">
      <div class="accordion-title">
        <strong>知识工作台</strong>
        <small>采集、筛选与升格</small>
      </div>
      <span class="accordion-toggle-icon" :class="{ open: menuOpen }">
        <ChevronDown :size="16" />
      </span>
    </button>

    <transition name="accordion">
      <div class="accordion-body" v-show="menuOpen">
        <div class="provider-list">
          <button
            v-for="item in items"
            :key="item.id"
            type="button"
            class="provider-item"
            :class="{ active: activeProvider === item.id }"
            @click="onSelect(item.id)"
            :title="item.title"
          >
            <div class="provider-main">
              <span class="provider-badge" data-provider="knowledge-sources">KB</span>
              <strong class="provider-label">{{ item.label }}</strong>
            </div>
            <div class="provider-count">
              <span>{{ item.badge }}</span>
            </div>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>
