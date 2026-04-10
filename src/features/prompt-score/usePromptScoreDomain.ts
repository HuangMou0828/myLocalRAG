import { ref, type Ref } from 'vue'
import type { FlowNode, MessageChunk } from '@/features/session-flow/useSessionFlowDomain'
import type { PromptApi } from '@/services/kbApiServices'

export interface PromptScoreIssue {
  code: string
  severity: 'low' | 'medium' | 'high'
  message: string
  evidence: string
  resolvedByContext?: boolean
  resolvedReason?: string
}

export interface PromptScoreResult {
  promptId: string
  rubricVersion: string
  scoringMode?: 'heuristic' | 'hybrid'
  taskType?: 'coding' | 'writing' | 'general'
  contextMeta?: {
    totalMessages: number
    relevantMessages: number
    relevanceScore: number
    mode: 'relevance-gated'
  }
  effectAssessment?: PromptEffectAssessment
  sourceRefs?: {
    dimensions?: Array<{
      key: string
      name: string
      sourceRefs: Array<{ id: string; title: string; url: string }>
      suggestions?: Array<{
        id: string
        sourceId: string
        sourceTitle: string
        sourceUrl: string
        title: string
        description: string
        hit: boolean
        evidence: string
      }>
    }>
    scoringPolicy?: {
      description?: string
    }
    antiPatternPolicy?: {
      description?: string
    }
  }
  scores: {
    clarity: number
    context: number
    constraints: number
    verifiability: number
    structure: number
  }
  weightedTotal: number
  baseWeightedTotal?: number
  contextAdjustment?: number
  contextApplied?: boolean
  rawWeightedTotal: number
  level: string
  antiPatterns: PromptScoreIssue[]
  topFixes: string[]
}

export interface PromptEffectAssessment {
  available: boolean
  mode: 'model-judge' | 'unavailable'
  verdict: 'strong' | 'usable' | 'weak' | 'unknown'
  confidence: number
  summary: string
  strengths: string[]
  risks: string[]
  model?: string
}

export interface PromptEffectAssessmentResult {
  promptId: string
  taskType?: string
  cached?: boolean
  cacheKey?: string
  meta?: {
    source?: string
  }
  createdAt?: string | null
  updatedAt?: string | null
  effectAssessment: PromptEffectAssessment
}

export interface PromptOptimizeResult {
  promptId: string
  mode: 'dspy' | 'fallback'
  language?: string
  taskType?: string
  model?: string
  optimizedPrompt: string
  cached?: boolean
  cacheKey?: string
  createdAt?: string | null
  updatedAt?: string | null
  changes?: string[]
  rationale?: string[]
  meta?: {
    dspyAvailable?: boolean
    model?: string
    apiBase?: string
    fallbackReason?: string
  }
}

interface PromptScoreRequestPayload {
  prompt: string
  promptId: string
  contextMessages: string[]
  taskType: 'coding' | 'writing' | 'general'
}

interface UsePromptScoreDomainOptions {
  service: PromptApi<PromptScoreResult, PromptOptimizeResult, PromptEffectAssessmentResult>
  selectedSessionFlow: Ref<FlowNode[]>
  joinChunkText: (chunks: MessageChunk[]) => string
}

export function usePromptScoreDomain(options: UsePromptScoreDomainOptions) {
  const promptScoreModalOpen = ref(false)
  const promptScoreLoading = ref(false)
  const promptScoreError = ref('')
  const promptScoreTargetText = ref('')
  const promptScoreTargetNodeId = ref('')
  const promptScoreTaskType = ref<'coding' | 'writing' | 'general'>('general')
  const promptScoreResult = ref<PromptScoreResult | null>(null)
  const promptEffectAssessmentLoading = ref(false)
  const promptEffectAssessmentCacheLoading = ref(false)
  const promptEffectAssessmentError = ref('')
  const promptEffectAssessmentResult = ref<PromptEffectAssessmentResult | null>(null)
  const promptOptimizeLoading = ref(false)
  const promptOptimizeError = ref('')
  const promptOptimizeResult = ref<PromptOptimizeResult | null>(null)
  const promptOptimizeLanguage = ref<'zh-CN' | 'en-US'>('zh-CN')

  function getContextMessagesForNode(node: FlowNode): string[] {
    const flow = options.selectedSessionFlow.value || []
    const index = flow.findIndex((item) => item.id === node.id)
    if (index <= 0) return []

    return flow
      .slice(Math.max(0, index - 8), index)
      .map((item) => `${item.role}: ${options.joinChunkText(item.chunks)}`)
      .filter((item) => item.length > 0)
  }

  function inferPromptTaskType(prompt: string, contextMessages: string[]) {
    const text = `${prompt}\n${contextMessages.join('\n')}`.toLowerCase()
    if (/(代码|组件|页面|接口|函数|仓库|报错|bug|fix|refactor|ts|tsx|js|jsx|vue|react|api|sql|shell|脚本|调试)/u.test(text)) {
      return 'coding' as const
    }
    if (/(文章|文案|标题|公众号|润色|改写|翻译|写作|风格|语气|摘要|总结|宣传|脚本|大纲|创意)/u.test(text)) {
      return 'writing' as const
    }
    return 'general' as const
  }

  function buildPromptRequestPayload(node: FlowNode | null | undefined): PromptScoreRequestPayload | null {
    if (!node) return null
    const prompt = options.joinChunkText(node.chunks)
    if (!prompt) return null
    const contextMessages = getContextMessagesForNode(node)
    return {
      prompt,
      promptId: node.messageIds?.[0] || node.id,
      contextMessages,
      taskType: inferPromptTaskType(prompt, contextMessages),
    }
  }

  function getPromptRequestPayloadByTarget(): PromptScoreRequestPayload | null {
    const node = options.selectedSessionFlow.value.find((item) => item.id === promptScoreTargetNodeId.value)
    if (node) return buildPromptRequestPayload(node)
    const prompt = String(promptScoreTargetText.value || '').trim()
    if (!prompt) return null
    return {
      prompt,
      promptId: promptScoreTargetNodeId.value,
      contextMessages: [],
      taskType: promptScoreTaskType.value,
    }
  }

  async function loadPromptScore(payload: PromptScoreRequestPayload) {
    try {
      promptScoreTaskType.value = payload.taskType
      const scoreResult = await options.service.scorePrompt({
        ...payload,
        includeEffectAssessment: false,
      })
      promptScoreResult.value = scoreResult
    } catch (error) {
      promptScoreError.value = String(error)
    } finally {
      promptScoreLoading.value = false
    }
  }

  async function loadCachedPromptEffectAssessment(payload: PromptScoreRequestPayload) {
    promptEffectAssessmentCacheLoading.value = true
    promptEffectAssessmentError.value = ''
    promptEffectAssessmentResult.value = null

    try {
      const result = await options.service.assessPromptEffect({
        ...payload,
        cacheOnly: true,
      })
      promptEffectAssessmentResult.value = result
    } catch (error) {
      promptEffectAssessmentError.value = `读取上次实战评估失败：${String(error)}`
    } finally {
      promptEffectAssessmentCacheLoading.value = false
    }
  }

  function openPromptScoreModal(node: FlowNode) {
    if (node.role !== 'user') return
    const payload = buildPromptRequestPayload(node)

    promptScoreModalOpen.value = true
    promptScoreLoading.value = true
    promptScoreError.value = ''
    promptScoreResult.value = null
    promptEffectAssessmentLoading.value = false
    promptEffectAssessmentCacheLoading.value = false
    promptEffectAssessmentError.value = ''
    promptEffectAssessmentResult.value = null
    promptScoreTargetText.value = payload?.prompt || ''
    promptScoreTargetNodeId.value = node.id
    promptScoreTaskType.value = payload?.taskType || 'general'

    if (!payload) {
      promptScoreError.value = '无法评测：Prompt 内容为空'
      promptScoreLoading.value = false
      return
    }

    void loadPromptScore(payload)
    void loadCachedPromptEffectAssessment(payload)
  }

  function closePromptScoreModal() {
    promptScoreModalOpen.value = false
    promptScoreLoading.value = false
    promptScoreError.value = ''
    promptScoreTargetText.value = ''
    promptScoreTargetNodeId.value = ''
    promptScoreTaskType.value = 'general'
    promptScoreResult.value = null
    promptEffectAssessmentLoading.value = false
    promptEffectAssessmentCacheLoading.value = false
    promptEffectAssessmentError.value = ''
    promptEffectAssessmentResult.value = null
    promptOptimizeLoading.value = false
    promptOptimizeError.value = ''
    promptOptimizeResult.value = null
  }

  async function runPromptEffectAssessment(forceRegenerate = false) {
    const payload = getPromptRequestPayloadByTarget()
    if (!payload) {
      promptEffectAssessmentError.value = '无法评估：Prompt 内容为空'
      return
    }

    promptEffectAssessmentLoading.value = true
    promptEffectAssessmentError.value = ''

    try {
      const result = await options.service.assessPromptEffect({
        ...payload,
        forceRegenerate,
      })
      promptEffectAssessmentResult.value = result
    } catch (error) {
      promptEffectAssessmentError.value = String(error)
    } finally {
      promptEffectAssessmentLoading.value = false
    }
  }

  async function runPromptOptimize(forceRegenerate = false) {
    const payload = getPromptRequestPayloadByTarget()
    if (!payload) return

    promptOptimizeLoading.value = true
    promptOptimizeError.value = ''
    promptOptimizeResult.value = null

    try {
      const result = await options.service.optimizePrompt({
        prompt: payload.prompt,
        promptId: payload.promptId,
        taskType: payload.taskType,
        language: promptOptimizeLanguage.value,
        forceRegenerate,
        contextMessages: payload.contextMessages,
      })
      promptOptimizeResult.value = result
    } catch (error) {
      promptOptimizeError.value = String(error)
    } finally {
      promptOptimizeLoading.value = false
    }
  }

  function severityLabel(value: string): string {
    if (value === 'high') return '高'
    if (value === 'medium') return '中'
    return '低'
  }

  function getPromptScoreDimensions(scores: PromptScoreResult['scores']) {
    return [
      { key: 'clarity', label: '目标清晰度', value: scores.clarity, color: '#4fd1c5', completion: Math.round((scores.clarity / 5) * 100) },
      { key: 'context', label: '上下文充分度', value: scores.context, color: '#60a5fa', completion: Math.round((scores.context / 5) * 100) },
      { key: 'constraints', label: '约束完整性', value: scores.constraints, color: '#f59e0b', completion: Math.round((scores.constraints / 5) * 100) },
      {
        key: 'verifiability',
        label: '输出可验证性',
        value: scores.verifiability,
        color: '#f87171',
        completion: Math.round((scores.verifiability / 5) * 100),
      },
      { key: 'structure', label: '结构化程度', value: scores.structure, color: '#a78bfa', completion: Math.round((scores.structure / 5) * 100) },
    ] as const
  }

  function getScoreBand(total: number) {
    if (total >= 90) return { key: 'excellent', label: '优秀', emoji: '🏆' }
    if (total >= 75) return { key: 'good', label: '良好', emoji: '✅' }
    if (total >= 60) return { key: 'ok', label: '可用', emoji: '⚠️' }
    return { key: 'weak', label: '较弱', emoji: '🛠️' }
  }

  function getPromptTaskTypeLabel(taskType: string) {
    if (taskType === 'coding') return '代码任务'
    if (taskType === 'writing') return '写作任务'
    return '通用任务'
  }

  function getPromptVerdictLabel(verdict: string) {
    if (verdict === 'strong') return '较强'
    if (verdict === 'usable') return '可用'
    if (verdict === 'weak') return '偏弱'
    return '未知'
  }

  function getScoreRingStyle(scores: PromptScoreResult['scores']) {
    const items = getPromptScoreDimensions(scores)
    const total = items.reduce((sum, item) => sum + item.value, 0)
    if (!total) return { background: 'conic-gradient(rgba(114, 147, 181, 0.24) 0% 100%)' }

    let cursor = 0
    const segments: string[] = []
    for (const item of items) {
      const percentage = (item.value / total) * 100
      const end = cursor + percentage
      segments.push(`${item.color} ${cursor.toFixed(2)}% ${end.toFixed(2)}%`)
      cursor = end
    }

    return {
      background: `conic-gradient(${segments.join(', ')})`,
    }
  }

  function collectPromptSources(result: PromptScoreResult): Array<{ id: string; title: string; url: string }> {
    const items = result.sourceRefs?.dimensions || []
    const map = new Map<string, { id: string; title: string; url: string }>()
    for (const dimension of items) {
      for (const ref of dimension.sourceRefs || []) {
        if (!ref?.id || !ref?.url) continue
        map.set(ref.id, ref)
      }
    }
    return Array.from(map.values())
  }

  function stripOuterCodeFence(input: string): string {
    const raw = String(input || '').replace(/\r\n/g, '\n').trim()
    if (!raw) return ''
    const lines = raw.split('\n')
    const isFence = (line: string) => /^```[a-zA-Z0-9_-]*\s*$/.test(String(line || '').trim())

    if (lines.length >= 2 && isFence(lines[0]) && isFence(lines[lines.length - 1])) {
      return lines.slice(1, -1).join('\n').trim()
    }

    if (lines.length >= 1 && isFence(lines[0])) {
      return lines.slice(1).join('\n').trim()
    }

    return raw
  }

  function getSourceLegend(result: PromptScoreResult) {
    const dimensions = result.sourceRefs?.dimensions || []
    return dimensions.map((dimension) => {
      const suggestions = Array.isArray(dimension.suggestions) ? dimension.suggestions : []
      const total = suggestions.length
      const hit = suggestions.filter((item) => item.hit).length
      const ratio = total > 0 ? Math.round((hit / total) * 100) : 0
      const refs = Array.from(
        new Map(
          suggestions
            .filter((item) => item.sourceTitle && item.sourceUrl)
            .map((item) => [item.sourceUrl, { title: item.sourceTitle, url: item.sourceUrl }]),
        ).values(),
      )

      return {
        key: dimension.key,
        name: dimension.name,
        total,
        hit,
        ratio,
        suggestions,
        refs,
      }
    })
  }

  function getSourceRadar(result: PromptScoreResult) {
    const items = getSourceLegend(result).slice(0, 8)
    const size = 260
    const center = size / 2
    const radius = 78
    const axisCount = Math.max(items.length, 3)
    const shortNameMap: Record<string, string> = {
      clarity: '清晰度',
      context: '上下文',
      constraints: '约束',
      verifiability: '可验证',
      structure: '结构化',
    }

    const points = items.map((item, index) => {
      const angle = (Math.PI * 2 * index) / axisCount - Math.PI / 2
      const valueRadius = (item.ratio / 100) * radius
      const x = center + Math.cos(angle) * valueRadius
      const y = center + Math.sin(angle) * valueRadius
      const axisX = center + Math.cos(angle) * radius
      const axisY = center + Math.sin(angle) * radius
      const labelX = center + Math.cos(angle) * (radius + 16)
      const labelY = center + Math.sin(angle) * (radius + 22)
      const anchor = labelX < center - 10 ? 'end' : labelX > center + 10 ? 'start' : 'middle'
      const labelOffset = anchor === 'end' ? -4 : anchor === 'start' ? 4 : 0
      return {
        ...item,
        x,
        y,
        axisX,
        axisY,
        labelX,
        labelY,
        labelText: shortNameMap[item.key] || item.name,
        anchor,
        labelOffset,
        angle,
      }
    })

    const polygon = points.map((p) => `${p.x},${p.y}`).join(' ')
    const rings = [25, 50, 75, 100].map((ratio) => ({ ratio, r: (ratio / 100) * radius }))

    return {
      size,
      center,
      radius,
      points,
      polygon,
      rings,
    }
  }

  return {
    promptScoreModalOpen,
    promptScoreLoading,
    promptScoreError,
    promptScoreTargetText,
    promptScoreTaskType,
    promptScoreTargetNodeId,
    promptScoreResult,
    promptEffectAssessmentLoading,
    promptEffectAssessmentCacheLoading,
    promptEffectAssessmentError,
    promptEffectAssessmentResult,
    promptOptimizeLoading,
    promptOptimizeError,
    promptOptimizeResult,
    promptOptimizeLanguage,
    openPromptScoreModal,
    closePromptScoreModal,
    runPromptEffectAssessment,
    runPromptOptimize,
    severityLabel,
    getPromptScoreDimensions,
    getScoreBand,
    getPromptTaskTypeLabel,
    getPromptVerdictLabel,
    getScoreRingStyle,
    collectPromptSources,
    stripOuterCodeFence,
    getSourceLegend,
    getSourceRadar,
  }
}
