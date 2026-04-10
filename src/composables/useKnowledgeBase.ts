import { computed, ref, watch } from 'vue'
import type { AIWorkspace, KnowledgeEntry, KnowledgeState, ProcessStep, StepType } from '../types'

const STORAGE_KEY = 'ai-process-kb:v1'

const palette = ['#ff6b6b', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function nowISO(): string {
  return new Date().toISOString()
}

function parseSteps(input: string): ProcessStep[] {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      const parts = line.split(':')
      const hasType = ['analysis', 'action', 'reflection'].includes(parts[0]?.toLowerCase() ?? '')
      const type = (hasType ? parts[0].toLowerCase() : 'analysis') as StepType
      const content = hasType ? parts.slice(1).join(':').trim() : line

      return {
        id: id('step'),
        title: `步骤 ${idx + 1}`,
        content,
        type,
        createdAt: nowISO(),
      }
    })
}

function seedData(): KnowledgeState {
  const workspaceId = id('ws')
  const createdAt = nowISO()

  return {
    workspaces: [
      {
        id: workspaceId,
        name: '通用 AI 助手',
        description: '默认目录，用于收集日常问题解决过程',
        color: palette[0],
        createdAt,
      },
    ],
    entries: [
      {
        id: id('entry'),
        workspaceId,
        title: '示例：定位线上接口超时问题',
        question: '某接口白天偶发超时，如何快速定位瓶颈？',
        answer: '先拆分链路耗时并加上结构化日志，再对慢 SQL 与下游依赖做聚合分析，最终定位为连接池配置过小。',
        reasoning:
          '将问题拆成“是否可复现、耗时在哪一层、是否和流量相关”三段。先通过日志验证超时发生区间，再按应用层、数据库层、外部依赖层逐步排除。',
        methodology:
          '先观测后优化；先定位层级再深入细节；每次只改变一个变量进行验证。',
        tags: ['故障排查', '性能', '后端'],
        steps: [
          {
            id: id('step'),
            title: '补齐可观测性',
            content: '给入口、DAO、外部调用加统一 traceId 和耗时日志。',
            type: 'action',
            createdAt,
          },
          {
            id: id('step'),
            title: '拆分链路耗时',
            content: '发现主要耗时集中在数据库查询阶段。',
            type: 'analysis',
            createdAt,
          },
          {
            id: id('step'),
            title: '总结复盘',
            content: '连接池与突发流量不匹配，调整后超时显著下降。',
            type: 'reflection',
            createdAt,
          },
        ],
        createdAt,
        updatedAt: createdAt,
      },
    ],
  }
}

function readState(): KnowledgeState {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return seedData()

  try {
    const parsed = JSON.parse(raw) as KnowledgeState
    if (!parsed.workspaces?.length) return seedData()
    return parsed
  } catch {
    return seedData()
  }
}

export function useKnowledgeBase() {
  const state = ref<KnowledgeState>(readState())
  const selectedWorkspaceId = ref<string>(state.value.workspaces[0]?.id ?? '')
  const selectedEntryId = ref<string>(state.value.entries[0]?.id ?? '')
  const keyword = ref('')

  watch(
    state,
    (value) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    },
    { deep: true },
  )

  const workspaces = computed(() => state.value.workspaces)

  const filteredEntries = computed(() => {
    const normalizedKeyword = keyword.value.trim().toLowerCase()

    return state.value.entries
      .filter((entry) => !selectedWorkspaceId.value || entry.workspaceId === selectedWorkspaceId.value)
      .filter((entry) => {
        if (!normalizedKeyword) return true

        const corpus = [
          entry.title,
          entry.question,
          entry.answer,
          entry.reasoning,
          entry.methodology,
          entry.tags.join(' '),
          ...entry.steps.map((step) => `${step.title} ${step.content}`),
        ]
          .join(' ')
          .toLowerCase()

        return corpus.includes(normalizedKeyword)
      })
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
  })

  const selectedEntry = computed(() => filteredEntries.value.find((entry) => entry.id === selectedEntryId.value))

  function addWorkspace(name: string, description: string): void {
    const createdAt = nowISO()
    const workspace: AIWorkspace = {
      id: id('ws'),
      name,
      description,
      color: palette[state.value.workspaces.length % palette.length],
      createdAt,
    }

    state.value.workspaces.unshift(workspace)
    selectedWorkspaceId.value = workspace.id
  }

  function addEntry(payload: {
    workspaceId: string
    title: string
    question: string
    answer: string
    reasoning: string
    methodology: string
    tags: string
    stepsText: string
  }): void {
    const timestamp = nowISO()
    const entry: KnowledgeEntry = {
      id: id('entry'),
      workspaceId: payload.workspaceId,
      title: payload.title,
      question: payload.question,
      answer: payload.answer,
      reasoning: payload.reasoning,
      methodology: payload.methodology,
      tags: payload.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      steps: parseSteps(payload.stepsText),
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    state.value.entries.unshift(entry)
    selectedEntryId.value = entry.id
  }

  function setKeyword(next: string): void {
    keyword.value = next
  }

  function setWorkspace(id: string): void {
    selectedWorkspaceId.value = id
    const firstEntry = filteredEntries.value[0]
    selectedEntryId.value = firstEntry?.id ?? ''
  }

  function setEntry(id: string): void {
    selectedEntryId.value = id
  }

  return {
    workspaces,
    filteredEntries,
    selectedEntry,
    selectedWorkspaceId,
    selectedEntryId,
    keyword,
    setKeyword,
    setWorkspace,
    setEntry,
    addWorkspace,
    addEntry,
  }
}
