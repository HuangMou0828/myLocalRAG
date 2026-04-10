<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, useSlots } from 'vue'

export interface ConfigTableColumn {
  key: string
  label: string
  minWidth: number
  defaultWidth: number
  expandable?: boolean
  thClass?: string
  tdClass?: string
  value?: (row: Record<string, unknown>) => unknown
}

const props = withDefaults(
  defineProps<{
    columns: ConfigTableColumn[]
    rows: Array<Record<string, unknown>>
    rowKey: string | ((row: Record<string, unknown>) => string)
    loading?: boolean
    loadingText?: string
    emptyText?: string
    tableClass?: string
    resizable?: boolean
    storageKey?: string
    defaultEmptyText?: string
  }>(),
  {
    loading: false,
    loadingText: '加载中...',
    emptyText: '暂无数据',
    tableClass: '',
    resizable: true,
    storageKey: '',
    defaultEmptyText: '-',
  },
)

const slots = useSlots()
const expandedCells = ref<Set<string>>(new Set())
const expandableCells = ref<Set<string>>(new Set())
const columnWidths = ref<number[]>(props.columns.map((item) => item.defaultWidth))
const tableWrapRef = ref<HTMLElement | null>(null)
const resizeState = ref({
  active: false,
  columnIndex: -1,
  startX: 0,
  startWidth: 0,
})
let overflowMeasureRaf = 0

const gridTemplate = computed(() => columnWidths.value.map((width) => `${Math.max(80, Math.round(width))}px`).join(' '))
const gridStyle = computed(() => ({ gridTemplateColumns: gridTemplate.value }))
const tableStyle = computed(() => ({
  minWidth: `${columnWidths.value.reduce((sum, width) => sum + width, 0)}px`,
}))

function resolveRowKey(row: Record<string, unknown>): string {
  if (typeof props.rowKey === 'function') return String(props.rowKey(row) || '').trim()
  return String(row?.[props.rowKey] || '').trim()
}

function getCellExpandKey(row: Record<string, unknown>, columnKey: string): string {
  return `${resolveRowKey(row)}::${String(columnKey || '').trim()}`
}

function isExpanded(row: Record<string, unknown>, columnKey: string): boolean {
  const key = getCellExpandKey(row, columnKey)
  return key ? expandedCells.value.has(key) : false
}

function toggleExpanded(row: Record<string, unknown>, columnKey: string) {
  const key = getCellExpandKey(row, columnKey)
  if (!key) return
  const next = new Set(expandedCells.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedCells.value = next
}

function isCellOverflowing(el: HTMLElement): boolean {
  const hadExpandedClass = el.classList.contains('bug-inbox-td-expanded')
  if (hadExpandedClass) el.classList.remove('bug-inbox-td-expanded')
  const overflowed = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
  if (hadExpandedClass) el.classList.add('bug-inbox-td-expanded')
  return overflowed
}

function recalcExpandableCells() {
  const container = tableWrapRef.value
  if (!container) return
  const next = new Set<string>()
  const cells = container.querySelectorAll<HTMLElement>('.bug-inbox-td[data-expand-key]')
  cells.forEach((cell) => {
    const key = String(cell.dataset.expandKey || '').trim()
    if (!key) return
    if (isCellOverflowing(cell)) next.add(key)
  })
  expandableCells.value = next
}

function scheduleRecalcExpandableCells() {
  if (typeof window === 'undefined') return
  if (overflowMeasureRaf) window.cancelAnimationFrame(overflowMeasureRaf)
  overflowMeasureRaf = window.requestAnimationFrame(() => {
    overflowMeasureRaf = 0
    recalcExpandableCells()
  })
}

function canExpand(row: Record<string, unknown>, columnKey: string): boolean {
  const key = getCellExpandKey(row, columnKey)
  return key ? expandableCells.value.has(key) : false
}

function canToggleExpanded(row: Record<string, unknown>, columnKey: string): boolean {
  return isExpanded(row, columnKey) || canExpand(row, columnKey)
}

function onExpandableCellClick(row: Record<string, unknown>, columnKey: string) {
  if (!canToggleExpanded(row, columnKey)) return
  toggleExpanded(row, columnKey)
  nextTick(() => {
    scheduleRecalcExpandableCells()
  })
}

function hasCellSlot(columnKey: string): boolean {
  return Boolean(slots[`cell-${columnKey}`])
}

function hasHeadSlot(columnKey: string): boolean {
  return Boolean(slots[`head-${columnKey}`])
}

function getCellValue(row: Record<string, unknown>, column: ConfigTableColumn): unknown {
  if (typeof column.value === 'function') return column.value(row)
  return row?.[column.key]
}

function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return props.defaultEmptyText
  const text = String(value).trim()
  return text || props.defaultEmptyText
}

function loadColumnWidths() {
  if (typeof window === 'undefined') return
  if (!props.storageKey) return
  try {
    const raw = localStorage.getItem(props.storageKey)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length !== props.columns.length) return
    const normalized = parsed.map((value, index) => {
      const width = Number(value)
      if (!Number.isFinite(width)) return props.columns[index].defaultWidth
      return Math.max(props.columns[index].minWidth, Math.round(width))
    })
    columnWidths.value = normalized
  } catch {
    // ignore invalid storage
  }
}

function saveColumnWidths() {
  if (typeof window === 'undefined') return
  if (!props.storageKey) return
  localStorage.setItem(props.storageKey, JSON.stringify(columnWidths.value))
}

function onResizeMove(event: MouseEvent) {
  if (!resizeState.value.active) return
  const index = resizeState.value.columnIndex
  if (index < 0 || index >= props.columns.length) return
  const deltaX = event.clientX - resizeState.value.startX
  const minWidth = props.columns[index].minWidth
  const nextWidth = Math.max(minWidth, Math.round(resizeState.value.startWidth + deltaX))
  const next = [...columnWidths.value]
  next[index] = nextWidth
  columnWidths.value = next
}

function stopResize() {
  if (!resizeState.value.active) return
  resizeState.value.active = false
  resizeState.value.columnIndex = -1
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', stopResize)
  saveColumnWidths()
  scheduleRecalcExpandableCells()
}

function startResize(index: number, event: MouseEvent) {
  if (!props.resizable) return
  if (index < 0 || index >= props.columns.length - 1) return
  event.preventDefault()
  resizeState.value.active = true
  resizeState.value.columnIndex = index
  resizeState.value.startX = event.clientX
  resizeState.value.startWidth = columnWidths.value[index]
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', stopResize)
}

onMounted(() => {
  loadColumnWidths()
  window.addEventListener('resize', scheduleRecalcExpandableCells)
  nextTick(() => {
    scheduleRecalcExpandableCells()
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', stopResize)
  window.removeEventListener('resize', scheduleRecalcExpandableCells)
  if (typeof window !== 'undefined' && overflowMeasureRaf) {
    window.cancelAnimationFrame(overflowMeasureRaf)
    overflowMeasureRaf = 0
  }
})

watch(
  [() => props.rows, () => props.columns, () => props.loading, columnWidths],
  () => {
    nextTick(() => {
      scheduleRecalcExpandableCells()
    })
  },
  { deep: true },
)
</script>

<template>
  <div v-if="loading" class="bug-inbox-table-wrap table-state-wrap">
    <div class="table-state">
      <span class="table-loading-spinner" aria-hidden="true" />
      <p class="table-state-text">{{ loadingText }}</p>
    </div>
  </div>
  <div v-else-if="!rows.length" class="bug-inbox-table-wrap table-state-wrap">
    <div class="table-state table-state-empty">
      <svg class="table-empty-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="10" y="14" width="44" height="36" rx="8" stroke="currentColor" stroke-width="2" />
        <path d="M20 26H44M20 34H38" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        <circle cx="46" cy="44" r="6" stroke="currentColor" stroke-width="2" />
        <path d="M50 48L55 53" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <p class="table-state-text">{{ emptyText }}</p>
    </div>
  </div>
  <div ref="tableWrapRef" v-else class="bug-inbox-table-wrap" :class="{ resizing: resizeState.active }">
    <div class="bug-inbox-table" :class="tableClass" :style="tableStyle">
      <div class="bug-inbox-thead" :style="gridStyle">
        <div class="bug-inbox-th" :class="column.thClass" v-for="(column, columnIndex) in columns" :key="column.key">
          <slot v-if="hasHeadSlot(column.key)" :name="`head-${column.key}`" :column="column" />
          <span v-else>{{ column.label }}</span>
          <button
            v-if="resizable && columnIndex < columns.length - 1"
            type="button"
            class="bug-inbox-col-resizer"
            :aria-label="`拖拽调整 ${column.label} 列宽`"
            :title="`拖拽调整 ${column.label} 列宽`"
            @mousedown="startResize(columnIndex, $event)"
          />
        </div>
      </div>
      <div class="bug-inbox-tbody">
        <article class="bug-inbox-tr" :style="gridStyle" v-for="row in rows" :key="resolveRowKey(row)">
          <template v-for="column in columns" :key="`${resolveRowKey(row)}::${column.key}`">
            <div
              class="bug-inbox-td"
              :class="[
                column.tdClass,
                column.expandable && canExpand(row, column.key) ? 'bug-inbox-td-expandable' : '',
                column.expandable && isExpanded(row, column.key) ? 'bug-inbox-td-expanded' : '',
              ]"
              :data-expand-key="column.expandable ? getCellExpandKey(row, column.key) : undefined"
              :title="column.expandable && canToggleExpanded(row, column.key) ? (isExpanded(row, column.key) ? '点击收起' : toDisplayValue(getCellValue(row, column))) : ''"
              @click="column.expandable ? onExpandableCellClick(row, column.key) : undefined"
            >
              <slot
                v-if="hasCellSlot(column.key)"
                :name="`cell-${column.key}`"
                :row="row"
                :value="getCellValue(row, column)"
                :column="column"
                :expanded="isExpanded(row, column.key)"
                :toggle-expand="() => toggleExpanded(row, column.key)"
              />
              <template v-else>{{ toDisplayValue(getCellValue(row, column)) }}</template>
            </div>
          </template>
        </article>
      </div>
    </div>
  </div>
</template>
