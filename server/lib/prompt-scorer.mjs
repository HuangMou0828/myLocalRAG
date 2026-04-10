import { createHash } from 'node:crypto'
import { askModel } from './ask-model.mjs'
import { loadPromptEffectAssessmentByKey, savePromptEffectAssessmentByKey } from './db.mjs'

const RUBRIC = {
  version: 'v2-hybrid-gated',
  label: 'Hybrid Prompt Review',
  description: '结构评分使用启发式规则，效果判断使用模型辅助评审，上下文补分采用相关性门控。',
  scoringLayers: [
    {
      id: 'structural-heuristic',
      title: '结构评分',
      mode: 'heuristic',
      description: '用于检查目标、上下文、约束、可验证性与结构化表达。',
    },
    {
      id: 'effect-assessment',
      title: '实战评估',
      mode: 'llm-assisted',
      description: '用于评估 Prompt 在当前任务类型下的可执行性与潜在风险。',
    },
  ],
  sources: [
    {
      id: 'openai_prompting',
      title: 'OpenAI Prompt Engineering',
      url: 'https://platform.openai.com/docs/guides/prompt-engineering',
    },
    {
      id: 'openai_reasoning_best_practices',
      title: 'OpenAI Reasoning Best Practices',
      url: 'https://platform.openai.com/docs/guides/reasoning-best-practices',
    },
    {
      id: 'anthropic_prompt_engineering_overview',
      title: 'Anthropic Prompt Engineering Overview',
      url: 'https://docs.anthropic.com/en/docs/prompt-engineering',
    },
    {
      id: 'google_prompt_best_practices',
      title: 'Google Prompt Design Strategies',
      url: 'https://ai.google.dev/guide/prompt_best_practices',
    },
  ],
  dimensions: [
    {
      key: 'clarity',
      name: '目标清晰度',
      weight: 25,
      sourceIds: ['openai_prompting', 'anthropic_prompt_engineering_overview', 'google_prompt_best_practices'],
    },
    {
      key: 'context',
      name: '上下文充分度',
      weight: 20,
      sourceIds: ['openai_prompting', 'anthropic_prompt_engineering_overview'],
    },
    {
      key: 'constraints',
      name: '约束完整性',
      weight: 20,
      sourceIds: ['openai_prompting', 'openai_reasoning_best_practices', 'google_prompt_best_practices'],
    },
    {
      key: 'verifiability',
      name: '输出可验证性',
      weight: 20,
      sourceIds: ['openai_prompting', 'anthropic_prompt_engineering_overview'],
    },
    {
      key: 'structure',
      name: '结构化程度',
      weight: 15,
      sourceIds: ['openai_prompting', 'openai_reasoning_best_practices', 'google_prompt_best_practices'],
    },
  ],
}

const TASK_RUBRIC_MAP = {
  coding: {
    clarity: 25,
    context: 20,
    constraints: 20,
    verifiability: 22,
    structure: 13,
  },
  writing: {
    clarity: 26,
    context: 24,
    constraints: 16,
    verifiability: 10,
    structure: 24,
  },
  general: {
    clarity: 25,
    context: 20,
    constraints: 20,
    verifiability: 20,
    structure: 15,
  },
}

RUBRIC.taskProfiles = {
  coding: {
    label: '代码任务',
    weights: TASK_RUBRIC_MAP.coding,
  },
  writing: {
    label: '写作任务',
    weights: TASK_RUBRIC_MAP.writing,
  },
  general: {
    label: '通用任务',
    weights: TASK_RUBRIC_MAP.general,
  },
}

const ACTION_HINTS = [
  /请|帮我|帮忙|需要|请你/u,
  /写|生成|总结|分析|解释|改写|优化|翻译|提取|设计|实现|检查|review|summarize|analyze|rewrite|translate|generate|design|implement|fix/iu,
]

const CONTEXT_HINTS = [
  /背景|上下文|场景|前提|目标用户|受众|for|context|background|audience/iu,
  /以下|如下|基于|根据|已知|输入|input|given/iu,
]

const CONSTRAINT_HINTS = [
  /格式|输出|长度|字数|语气|风格|不要|必须|限制|JSON|Markdown|表格|yaml|schema|字段/iu,
  /\d+\s*(字|词|段|条|行|steps?|items?|words?)/iu,
]

const FORMAT_HINTS = [/json|yaml|markdown|md|表格|列表|bullet|schema|字段|csv|xml/iu]

const VERIFY_HINTS = [
  /验收|标准|检查|自检|评分|至少|必须包含|成功|quality|criteria|checklist|verify|validation/iu,
  /至少\s*\d+/u,
]

const STRUCTURE_HINTS = [/[\n\r].*[-*]\s+/u, /[\n\r].*\d+\.\s+/u, /[:：]\s*[\n\r]/u]

const ANTI_PATTERNS = {
  VAGUE_GOAL: {
    severity: 'medium',
    message: '目标描述偏泛，缺少清晰可执行动作。',
  },
  MULTI_TASK_MIXED: {
    severity: 'medium',
    message: '同一条 Prompt 包含多个主任务，容易导致输出发散。',
  },
  MISSING_OUTPUT_FORMAT: {
    severity: 'high',
    message: '未指定输出格式，结果可控性较弱。',
  },
  MISSING_SUCCESS_CRITERIA: {
    severity: 'high',
    message: '缺少验收标准，难以判断结果是否达标。',
  },
  CONTEXT_TOO_THIN: {
    severity: 'medium',
    message: '上下文信息偏少，模型可能需要猜测。',
  },
  CONSTRAINT_CONFLICT: {
    severity: 'high',
    message: '存在潜在约束冲突。',
  },
}

function normalizeText(input) {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .trim()
}

function pickEvidence(text, regex) {
  const match = text.match(regex)
  return match?.[0] || ''
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text))
}

function clampScore(score) {
  return Math.max(0, Math.min(5, score))
}

function stripCodeFence(text) {
  return String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function extractJsonText(input) {
  const raw = stripCodeFence(String(input || '').trim())
  if (!raw) return ''
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) return raw

  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fencedMatch?.[1]) return stripCodeFence(fencedMatch[1])

  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) return raw.slice(firstBrace, lastBrace + 1)
  return ''
}

function parseJsonLoose(input) {
  const raw = extractJsonText(input)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function normalizeStringList(input, maxItems = 3, maxChars = 120) {
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,\n、]/g)
      : []

  const unique = []
  const seen = new Set()
  for (const item of list) {
    const value = normalizeText(item).slice(0, maxChars)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(value)
    if (unique.length >= maxItems) break
  }
  return unique
}

function normalizeTaskType(input) {
  const value = String(input || '').trim().toLowerCase()
  if (value === 'coding' || value === 'writing') return value
  return 'general'
}

function detectMultiTask(text) {
  const taskVerbs = text.match(
    /写|生成|总结|分析|解释|改写|优化|翻译|提取|设计|实现|检查|review|summarize|analyze|rewrite|translate|generate|design|implement|fix/giu,
  )
  return (taskVerbs?.length || 0) >= 3
}

function detectConstraintConflict(text) {
  const hasDetailed = /详细|尽可能详细|全面|完整|thorough|detailed/iu.test(text)
  const strictShort = /(\d+)\s*(字|词|words?|字符)\s*(内|以内|以内完成)?/iu.exec(text)
  if (!hasDetailed || !strictShort) return null
  const limit = Number(strictShort[1] || 0)
  if (!limit || limit > 180) return null
  return `检测到“详细”与“${strictShort[0]}”可能冲突`
}

function scoreClarity(text, antiPatterns) {
  let score = 5
  const hasAction = hasAny(text, ACTION_HINTS)
  if (!hasAction) {
    score -= 2
    antiPatterns.push({
      code: 'VAGUE_GOAL',
      ...ANTI_PATTERNS.VAGUE_GOAL,
      evidence: '未识别明确动作词',
    })
  }

  if (detectMultiTask(text)) {
    score -= 1
    antiPatterns.push({
      code: 'MULTI_TASK_MIXED',
      ...ANTI_PATTERNS.MULTI_TASK_MIXED,
      evidence: '检测到多个任务动词并列出现',
    })
  }

  if (text.length < 12) {
    score -= 2
    antiPatterns.push({
      code: 'CONTEXT_TOO_THIN',
      ...ANTI_PATTERNS.CONTEXT_TOO_THIN,
      evidence: 'Prompt 长度过短',
    })
  }

  return clampScore(score)
}

function scoreContext(text, antiPatterns) {
  let score = 5
  const hasContext = hasAny(text, CONTEXT_HINTS)
  if (!hasContext) score -= 2
  if (text.length < 40) score -= 1
  if (/这个|上面|如下内容/u.test(text) && !/[:：]\s*[\n\r]|```/u.test(text)) {
    score -= 1
  }
  if (score <= 2) {
    antiPatterns.push({
      code: 'CONTEXT_TOO_THIN',
      ...ANTI_PATTERNS.CONTEXT_TOO_THIN,
      evidence: pickEvidence(text, /这个|上面|如下内容|背景|上下文/u) || '上下文线索不足',
    })
  }
  return clampScore(score)
}

function scoreConstraints(text, antiPatterns, taskType = 'general') {
  let score = 5
  const hasConstraint = hasAny(text, CONSTRAINT_HINTS)
  const hasFormat = hasAny(text, FORMAT_HINTS)
  if (!hasConstraint) score -= taskType === 'writing' ? 1 : 2
  if (!hasFormat) {
    score -= taskType === 'writing' ? 1 : 2
    if (taskType !== 'writing') {
      antiPatterns.push({
        code: 'MISSING_OUTPUT_FORMAT',
        ...ANTI_PATTERNS.MISSING_OUTPUT_FORMAT,
        evidence: '未检测到明确输出格式（如 JSON/表格/Markdown）',
      })
    }
  }

  const conflict = detectConstraintConflict(text)
  if (conflict) {
    score -= 1
    antiPatterns.push({
      code: 'CONSTRAINT_CONFLICT',
      ...ANTI_PATTERNS.CONSTRAINT_CONFLICT,
      evidence: conflict,
    })
  }

  return clampScore(score)
}

function scoreVerifiability(text, antiPatterns, taskType = 'general') {
  let score = 5
  const hasVerify = hasAny(text, VERIFY_HINTS)
  if (!hasVerify) {
    score -= taskType === 'writing' ? 1 : 3
    if (taskType !== 'writing') {
      antiPatterns.push({
        code: 'MISSING_SUCCESS_CRITERIA',
        ...ANTI_PATTERNS.MISSING_SUCCESS_CRITERIA,
        evidence: '未检测到验收/评分/检查标准',
      })
    }
  }
  if (!/\d+/u.test(text)) score -= taskType === 'writing' ? 0 : 1
  return clampScore(score)
}

function scoreStructure(text) {
  let score = 2
  if (text.length >= 60) score += 1
  if (hasAny(text, STRUCTURE_HINTS)) score += 1
  if (/```/u.test(text)) score += 1
  return clampScore(score)
}

function weightedTotal(scores, taskType = 'general') {
  const weights = TASK_RUBRIC_MAP[normalizeTaskType(taskType)] || TASK_RUBRIC_MAP.general
  return RUBRIC.dimensions.reduce((sum, item) => {
    const raw = Number(scores[item.key] || 0)
    return sum + (raw / 5) * Number(weights[item.key] || item.weight || 0)
  }, 0)
}

function dedupeAntiPatterns(list) {
  const seen = new Set()
  const next = []
  for (const item of list) {
    const key = item.code
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
  }
  return next
}

function normalizeContextMessages(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') return String(item.content || '')
      return ''
    })
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(-12)
}

function tokenizeForRelevance(text) {
  const raw = normalizeText(text).toLowerCase()
  if (!raw) return []
  const ascii = raw.match(/[a-z][a-z0-9_-]{1,}/g) || []
  const cjk = raw.match(/[\u4e00-\u9fff]{2,}/g) || []
  return [...ascii, ...cjk]
}

function computeTokenOverlap(a, b) {
  const aTokens = new Set(tokenizeForRelevance(a))
  const bTokens = new Set(tokenizeForRelevance(b))
  if (!aTokens.size || !bTokens.size) return { shared: 0, score: 0 }
  let shared = 0
  for (const token of aTokens) {
    if (bTokens.has(token)) shared += 1
  }
  const score = shared / Math.max(3, Math.min(aTokens.size, bTokens.size))
  return { shared, score }
}

function buildContextInsights(contextMessages, promptText = '') {
  const normalizedPrompt = normalizeText(promptText)
  const relevantMessages = contextMessages.filter((item) => {
    const overlap = computeTokenOverlap(normalizedPrompt, item)
    return overlap.shared >= 2 || overlap.score >= 0.2
  })
  const candidateMessages = relevantMessages.length ? relevantMessages : contextMessages.slice(-2)
  const text = normalizeText(candidateMessages.join('\n'))
  const relevance = candidateMessages.map((item) => computeTokenOverlap(normalizedPrompt, item))
  const relevantScore = relevance.length
    ? Number((relevance.reduce((sum, item) => sum + item.score, 0) / relevance.length).toFixed(3))
    : 0

  return {
    text,
    hasContext: hasAny(text, CONTEXT_HINTS),
    hasAction: hasAny(text, ACTION_HINTS),
    hasFormat: hasAny(text, FORMAT_HINTS),
    hasVerify: hasAny(text, VERIFY_HINTS),
    hasCodeScope: /代码|组件|页面|接口|函数|仓库|cursor|repo|file|ts|vue|react|api|bug|fix|refactor/iu.test(text),
    hasStrongHistory: text.length >= 100,
    totalMessages: contextMessages.length,
    relevantMessages: candidateMessages.length,
    relevantScore,
  }
}

function resolveAntiPatternByContext(pattern, contextInsights) {
  if (!contextInsights?.text) return { resolvedByContext: false, resolvedReason: '' }

  if (pattern.code === 'VAGUE_GOAL' && (contextInsights.hasAction || contextInsights.hasCodeScope)) {
    return { resolvedByContext: true, resolvedReason: '历史上下文已提供任务目标/代码范围。' }
  }
  if (pattern.code === 'CONTEXT_TOO_THIN' && (contextInsights.hasContext || contextInsights.hasStrongHistory)) {
    return { resolvedByContext: true, resolvedReason: '历史消息已补充背景和输入语境。' }
  }
  if (pattern.code === 'MISSING_OUTPUT_FORMAT' && contextInsights.hasFormat) {
    return { resolvedByContext: true, resolvedReason: '历史消息中已出现输出格式约定。' }
  }
  if (pattern.code === 'MISSING_SUCCESS_CRITERIA' && contextInsights.hasVerify) {
    return { resolvedByContext: true, resolvedReason: '历史消息中已出现验收/检查标准。' }
  }

  return { resolvedByContext: false, resolvedReason: '' }
}

function adjustSeverityByContext(severity, resolvedByContext) {
  if (!resolvedByContext) return severity
  if (severity === 'high') return 'medium'
  if (severity === 'medium') return 'low'
  return 'low'
}

function topFixes(scores, antiPatterns) {
  const fixes = []
  if (scores.constraints <= 3) fixes.push('补充输出格式和关键字段（如 JSON schema/表格列）。')
  if (scores.verifiability <= 3) fixes.push('补充验收标准（至少 2-3 条可检查规则）。')
  if (scores.context <= 3) fixes.push('补充背景、输入样例和边界条件。')
  if (antiPatterns.some((item) => item.code === 'MULTI_TASK_MIXED')) fixes.push('拆分为单一主任务，按步骤分别提问。')
  return fixes.slice(0, 3)
}

function levelByScore(total) {
  if (total >= 90) return '优秀'
  if (total >= 75) return '良好'
  if (total >= 60) return '可用'
  return '较弱'
}

function analyzeSignals(text) {
  const hasAction = hasAny(text, ACTION_HINTS)
  const isMultiTask = detectMultiTask(text)
  const hasContext = hasAny(text, CONTEXT_HINTS)
  const hasInputBlock = /[:：]\s*[\n\r]|```|以下|如下/u.test(text)
  const hasConstraint = hasAny(text, CONSTRAINT_HINTS)
  const hasFormat = hasAny(text, FORMAT_HINTS)
  const hasVerify = hasAny(text, VERIFY_HINTS)
  const hasNumericRequirement = /\d+/u.test(text)
  const hasStructure = hasAny(text, STRUCTURE_HINTS) || /```/u.test(text)
  const hasStepInstruction = /步骤|step|1\.\s|2\.\s|首先|然后|最后/u.test(text)
  const hasConflict = Boolean(detectConstraintConflict(text))

  return {
    hasAction,
    isMultiTask,
    hasContext,
    hasInputBlock,
    hasConstraint,
    hasFormat,
    hasVerify,
    hasNumericRequirement,
    hasStructure,
    hasStepInstruction,
    hasConflict,
  }
}

function buildDimensionSuggestions(key, text, signals) {
  if (key === 'clarity') {
    return [
      {
        id: 'clarity_explicit_action',
        sourceId: 'openai_prompting',
        title: '明确任务动作',
        description: 'Prompt 应包含明确动作词与目标。',
        hit: signals.hasAction,
        evidence: signals.hasAction ? pickEvidence(text, /写|生成|总结|分析|优化|翻译|设计|实现/iu) : '未检测到明确动作词',
      },
      {
        id: 'clarity_single_task',
        sourceId: 'anthropic_prompt_engineering_overview',
        title: '保持单任务聚焦',
        description: '避免多个主任务并列，降低输出发散。',
        hit: !signals.isMultiTask,
        evidence: signals.isMultiTask ? '检测到多个任务动词并列' : '未检测到明显多任务混杂',
      },
    ]
  }

  if (key === 'context') {
    return [
      {
        id: 'context_background',
        sourceId: 'openai_prompting',
        title: '提供背景与前提',
        description: '给出背景、场景与输入边界。',
        hit: signals.hasContext,
        evidence: signals.hasContext
          ? pickEvidence(text, /背景|上下文|场景|前提|根据|基于|input|context/iu)
          : '未检测到背景/上下文提示词',
      },
      {
        id: 'context_input_material',
        sourceId: 'anthropic_prompt_engineering_overview',
        title: '附上输入材料',
        description: '尽量提供“以下内容/代码块/原始文本”等输入材料。',
        hit: signals.hasInputBlock,
        evidence: signals.hasInputBlock ? pickEvidence(text, /以下|如下|```|[:：]\s*[\n\r]/u) : '未检测到输入材料块',
      },
    ]
  }

  if (key === 'constraints') {
    return [
      {
        id: 'constraints_output_format',
        sourceId: 'openai_prompting',
        title: '指定输出格式',
        description: '明确指定 JSON/表格/Markdown 等输出形态。',
        hit: signals.hasFormat,
        evidence: signals.hasFormat ? pickEvidence(text, /json|yaml|markdown|表格|schema|字段/iu) : '未检测到明确输出格式',
      },
      {
        id: 'constraints_limit_rules',
        sourceId: 'google_prompt_best_practices',
        title: '补充边界约束',
        description: '给出长度、条数、语气、禁忌项等边界。',
        hit: signals.hasConstraint && signals.hasNumericRequirement && !signals.hasConflict,
        evidence:
          signals.hasConstraint && signals.hasNumericRequirement
            ? pickEvidence(text, /\d+\s*(字|词|条|段|steps?|items?)/iu) || '检测到可量化约束'
            : '缺少可量化约束',
      },
    ]
  }

  if (key === 'verifiability') {
    return [
      {
        id: 'verifiability_acceptance',
        sourceId: 'openai_prompting',
        title: '定义验收标准',
        description: '说明结果判定标准或检查项。',
        hit: signals.hasVerify,
        evidence: signals.hasVerify
          ? pickEvidence(text, /验收|标准|检查|自检|criteria|checklist|verify/iu)
          : '未检测到验收/检查标准',
      },
      {
        id: 'verifiability_measurable',
        sourceId: 'anthropic_prompt_engineering_overview',
        title: '要求可度量输出',
        description: '使用可度量要求（如至少 N 条）。',
        hit: signals.hasNumericRequirement,
        evidence: signals.hasNumericRequirement ? pickEvidence(text, /\d+/u) : '未检测到可度量要求',
      },
    ]
  }

  return [
    {
      id: 'structure_segmented',
      sourceId: 'openai_reasoning_best_practices',
      title: '使用结构化表达',
      description: '用分段、列表或代码块提升可读性和稳定性。',
      hit: signals.hasStructure,
      evidence: signals.hasStructure ? pickEvidence(text, /```|[-*]\s+|\d+\.\s+/u) || '检测到结构化模式' : '未检测到结构化模式',
    },
    {
      id: 'structure_stepwise',
      sourceId: 'google_prompt_best_practices',
      title: '使用步骤化指令',
      description: '通过“步骤/先后顺序”降低执行歧义。',
      hit: signals.hasStepInstruction,
      evidence: signals.hasStepInstruction ? pickEvidence(text, /步骤|step|首先|然后|最后|\d+\.\s+/u) : '未检测到步骤化指令',
    },
  ]
}

function buildDimensionSourceRefs(text) {
  const sourceMap = new Map(RUBRIC.sources.map((item) => [item.id, item]))
  const signals = analyzeSignals(text)
  return RUBRIC.dimensions.map((dimension) => ({
    key: dimension.key,
    name: dimension.name,
    sourceRefs: (dimension.sourceIds || []).map((id) => sourceMap.get(id)).filter(Boolean),
    suggestions: buildDimensionSuggestions(dimension.key, text, signals).map((item) => ({
      ...item,
      sourceTitle: sourceMap.get(item.sourceId)?.title || item.sourceId,
      sourceUrl: sourceMap.get(item.sourceId)?.url || '',
    })),
  }))
}

export function scorePrompt(prompt, options = {}) {
  const text = normalizeText(prompt)
  const taskType = normalizeTaskType(options.taskType)
  const contextMessages = normalizeContextMessages(options.contextMessages)
  const contextInsights = buildContextInsights(contextMessages, text)
  const antiPatterns = []

  const scores = {
    clarity: scoreClarity(text, antiPatterns),
    context: scoreContext(text, antiPatterns),
    constraints: scoreConstraints(text, antiPatterns, taskType),
    verifiability: scoreVerifiability(text, antiPatterns, taskType),
    structure: scoreStructure(text),
  }

  const weighted = weightedTotal(scores, taskType)
  const antiPatternList = dedupeAntiPatterns(antiPatterns).map((item) => {
    const resolved = resolveAntiPatternByContext(item, contextInsights)
    return {
      ...item,
      severity: adjustSeverityByContext(item.severity, resolved.resolvedByContext),
      resolvedByContext: resolved.resolvedByContext,
      resolvedReason: resolved.resolvedReason,
    }
  })
  const unresolvedHighRisk = antiPatternList.some((item) => item.severity === 'high' && !item.resolvedByContext)
  const capped = unresolvedHighRisk ? Math.min(weighted, 69) : weighted
  const contextResolvedCount = antiPatternList.filter((item) => item.resolvedByContext).length
  const contextAdjustment = contextInsights.relevantScore >= 0.12
    ? Math.min(9, contextResolvedCount * 3)
    : 0
  const finalTotal = Math.min(100, capped + contextAdjustment)

  return {
    promptId: String(options.promptId || ''),
    rubricVersion: RUBRIC.version,
    scoringMode: 'hybrid',
    taskType,
    sourceRefs: {
      dimensions: buildDimensionSourceRefs(text),
      scoringPolicy: {
        description: '总览分数为结构评分；实战评估作为独立辅助层展示，不直接并入结构总分。',
      },
      antiPatternPolicy: {
        description: '反模式规则为本项目工程化启发式检测，并会结合相关历史上下文做有限修正。',
      },
    },
    scores,
    weightedTotal: Number(finalTotal.toFixed(2)),
    baseWeightedTotal: Number(capped.toFixed(2)),
    contextAdjustment,
    contextApplied: contextResolvedCount > 0,
    contextMeta: {
      totalMessages: contextInsights.totalMessages,
      relevantMessages: contextInsights.relevantMessages,
      relevanceScore: contextInsights.relevantScore,
      mode: 'relevance-gated',
    },
    rawWeightedTotal: Number(weighted.toFixed(2)),
    level: levelByScore(finalTotal),
    antiPatterns: antiPatternList,
    topFixes: topFixes(scores, antiPatternList),
  }
}

function buildPromptAssessmentMessages({ prompt, taskType = 'general', contextMessages = [] } = {}) {
  const contextBlock = normalizeContextMessages(contextMessages)
    .slice(-6)
    .map((item, index) => `${index + 1}. ${item}`)
    .join('\n')

  return [
    {
      role: 'system',
      content: [
        '你是 Prompt 质量评审器，目标不是改写 Prompt，而是评估它在当前任务下的可执行性与风险。',
        '请结合任务类型、上下文和 Prompt 本身，给出尽量克制、工程化的判断。',
        '只输出 JSON，不要输出额外说明。',
        'JSON schema: {"verdict":"strong|usable|weak","confidence":0-100,"summary":"","strengths":[""],"risks":[""]}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `任务类型: ${taskType}`,
        `Prompt:\n${normalizeText(prompt)}`,
        contextBlock ? `相关历史上下文:\n${contextBlock}` : '相关历史上下文: 无',
      ].join('\n\n'),
    },
  ]
}

function buildPromptEffectAssessmentCacheKey(prompt, options = {}) {
  const assistantConfig = options.assistantConfig || {}
  const serialized = JSON.stringify({
    prompt: normalizeText(prompt),
    taskType: normalizeText(options.taskType || 'general'),
    contextMessages: normalizeContextMessages(options.contextMessages || []),
    model: normalizeText(assistantConfig.model || ''),
    apiBase: normalizeText(assistantConfig.apiBase || ''),
  })
  return createHash('sha256').update(serialized).digest('hex')
}

function normalizeAssessmentConfidence(value, verdict = 'unknown') {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    return Math.max(0, Math.min(100, numeric))
  }

  const text = normalizeText(value).toLowerCase()
  if (text) {
    const matched = text.match(/(\d+(?:\.\d+)?)/)
    if (matched) {
      return Math.max(0, Math.min(100, Number(matched[1] || 0)))
    }
    if (/(很高|较高|高|high)/.test(text)) return 85
    if (/(中等|适中|medium|中)/.test(text)) return 68
    if (/(偏低|较低|低|low)/.test(text)) return 38
  }

  if (verdict === 'strong') return 85
  if (verdict === 'usable') return 68
  if (verdict === 'weak') return 38
  return 0
}

function normalizeAssessmentSummary(value, fallback = '') {
  if (typeof value === 'string') return normalizeText(value).slice(0, 1200)
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    try {
      return JSON.stringify(value, null, 2).slice(0, 1200)
    } catch {}
  }
  return normalizeText(fallback).slice(0, 1200)
}

async function assessPromptEffect(prompt, options = {}) {
  const assistantConfig = options.assistantConfig || {}
  if (!assistantConfig.apiKey || !assistantConfig.apiBase || !assistantConfig.model) {
    return {
      available: false,
      mode: 'unavailable',
      verdict: 'unknown',
      confidence: 0,
      summary: '未配置可用的评审模型，当前只展示规则启发式评分。',
      strengths: [],
      risks: [],
      model: '',
    }
  }

  try {
    const result = await askModel({
      messages: buildPromptAssessmentMessages({
        prompt,
        taskType: options.taskType || 'general',
        contextMessages: options.contextMessages || [],
      }),
      model: assistantConfig.model,
      apiBase: assistantConfig.apiBase,
      apiKey: assistantConfig.apiKey,
      timeoutMs: assistantConfig.timeoutMs || 30000,
      temperature: 0,
      topP: 1,
      maxTokens: 350,
    })
    const parsed = parseJsonLoose(result.answer) || {}
    const verdict = ['strong', 'usable', 'weak'].includes(String(parsed.verdict || ''))
      ? String(parsed.verdict)
      : 'usable'
    return {
      available: true,
      mode: 'model-judge',
      verdict,
      confidence: normalizeAssessmentConfidence(parsed.confidence, verdict),
      summary: normalizeAssessmentSummary(parsed.summary, result.answer),
      strengths: normalizeStringList(parsed.strengths, 3, 100),
      risks: normalizeStringList(parsed.risks, 3, 100),
      model: String(result.model || assistantConfig.model || ''),
    }
  } catch (error) {
    return {
      available: false,
      mode: 'unavailable',
      verdict: 'unknown',
      confidence: 0,
      summary: `模型评审暂不可用：${String(error).slice(0, 180)}`,
      strengths: [],
      risks: [],
      model: '',
    }
  }
}

export async function loadPromptEffectAssessment(prompt, options = {}) {
  const cacheKey = buildPromptEffectAssessmentCacheKey(prompt, options)
  const cached = await loadPromptEffectAssessmentByKey(cacheKey)
  if (!cached) return null
  return {
    ...cached,
    cached: true,
  }
}

export async function assessPromptEffectWithCache(prompt, options = {}) {
  const cacheKey = buildPromptEffectAssessmentCacheKey(prompt, options)

  if (!options.forceRegenerate) {
    const cached = await loadPromptEffectAssessmentByKey(cacheKey)
    if (cached) {
      return {
        ...cached,
        cached: true,
      }
    }
  }

  const effectAssessment = await assessPromptEffect(prompt, options)
  const saved = await savePromptEffectAssessmentByKey({
    cacheKey,
    promptId: options.promptId || '',
    taskType: options.taskType || 'general',
    effectAssessment,
    meta: {
      source: 'prompt-score',
    },
  })
  return {
    ...saved,
    cached: false,
  }
}

export async function scorePromptDetailed(prompt, options = {}) {
  const base = scorePrompt(prompt, options)
  const effectAssessment = options.includeEffectAssessment === false
    ? undefined
    : (await assessPromptEffectWithCache(prompt, options)).effectAssessment
  return {
    ...base,
    effectAssessment,
  }
}

export function scorePrompts(prompts) {
  const items = Array.isArray(prompts) ? prompts : []
  return items.map((item, index) => {
    if (typeof item === 'string') return scorePrompt(item, { promptId: `prompt_${index + 1}` })
    return scorePrompt(item?.text || '', { promptId: item?.id || `prompt_${index + 1}` })
  })
}

export function getPromptRubric() {
  return RUBRIC
}
