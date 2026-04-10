import { computed, ref } from 'vue'
import type {
  KnowledgeItemDto,
  KnowledgeItemsApi,
  KnowledgeStatsDto,
  SessionDataApi,
  WikiVaultApi,
} from '@/services/kbApiServices'
import type { Issue, SessionItem, SessionRetrieveResponse, SessionReviewStatus } from '@/features/session/types'

type KnowledgeSourceType = 'capture' | 'note' | 'document'
type KnowledgeStatus = 'draft' | 'active' | 'archived'
type KnowledgeSourceTypeFilter = 'all' | KnowledgeSourceType
type KnowledgeStatusFilter = 'all' | KnowledgeStatus
type KnowledgeIntakeStage = 'inbox' | 'needs-context' | 'search-candidate' | 'wiki-candidate' | 'reference-only'
type KnowledgeConfidence = 'low' | 'medium' | 'high'
type KnowledgeIntakeStageFilter = 'all' | KnowledgeIntakeStage
type KnowledgeConfidenceFilter = 'all' | KnowledgeConfidence
type QuickCaptureMode = 'single' | 'batch'
type KnowledgeWorkbenchTab = 'raw' | 'task-review' | 'promotion' | 'health'
type TaskReviewType =
  | 'bug-investigation'
  | 'coding-task'
  | 'architecture-discussion'
  | 'prompt-design'
  | 'general-knowledge'
  | 'context-fragment'
  | 'chitchat'
type TaskReviewAction = 'keep-search' | 'promote-candidate' | 'archive-only' | 'ignore-noise' | 'needs-context'
type TaskReviewStatusFilter = 'all' | SessionReviewStatus
type TaskReviewTypeFilter = 'all' | TaskReviewType
type PromotionTargetKind = 'issue-review' | 'pattern-candidate' | 'synthesis-candidate'
type TaskReviewActionFilter = 'all' | TaskReviewAction
type TaskReviewAnswerFilter = 'all' | 'essence' | 'non-essence'
type TaskReviewPromotionTargetFilter = 'all' | PromotionTargetKind

interface UseKnowledgeSourcesDomainOptions {
  service: KnowledgeItemsApi
  sessionService: SessionDataApi<SessionItem, Issue, SessionRetrieveResponse>
  wikiService: WikiVaultApi
  notify: (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void
  onQuickCaptureSaved?: (item: KnowledgeItemDto) => void
}

interface TaskReviewItem {
  id: string
  sessionId: string
  sessionTitle: string
  segmentIndex: number
  segmentCount: number
  segmentLabel: string
  title: string
  provider: string
  updatedAt: string
  tags: string[]
  project: string
  firstUserIntent: string
  latestAssistantReply: string
  bestAssistantAnswer: string
  reviewStatus: SessionReviewStatus
  isPromoteCandidate: boolean
  keepInSearch: boolean
  qualityScore: number | null
  taskType: TaskReviewType
  contextCompleteness: number
  retrievalValue: number
  promotionValue: number
  answerValue: number
  noiseRisk: number
  isAnswerEssence: boolean
  answerEssenceReasons: string[]
  recommendedAction: TaskReviewAction
  predictedPromotionTarget: PromotionTargetKind
  promotionRouteHint: string
  reasoning: string
  messageCount: number
  sessionMessageCount: number
}

interface TaskReviewSessionGroup {
  id: string
  title: string
  provider: string
  updatedAt: string
  tags: string[]
  project: string
  reviewStatus: SessionReviewStatus
  isPromoteCandidate: boolean
  keepInSearch: boolean
  qualityScore: number | null
  segmentCount: number
  taskTypes: TaskReviewType[]
  primarySegmentId: string
  primarySegmentTitle: string
  primaryTaskType: TaskReviewType
  primaryRecommendedAction: TaskReviewAction
  primaryContextCompleteness: number
  primaryRetrievalValue: number
  primaryPromotionValue: number
  primaryAnswerValue: number
  primaryIsAnswerEssence: boolean
  primaryNoiseRisk: number
  reasoning: string
  segments: TaskReviewItem[]
}

interface TaskSegmentSlice {
  id: string
  index: number
  total: number
  messages: SessionItem['messages']
  firstUserIntent: string
  latestAssistantReply: string
}

type PromotionQueueItem = {
  kind: 'issue-review' | 'pattern-candidate' | 'synthesis-candidate'
  segmentId?: string
  segmentLabel?: string
  title: string
  currentPath?: string
  targetPath?: string
  project?: string
  summary?: string
  evidenceItems: string[]
  sourceKind?: string
  sourceLabel?: string
  updatedAt?: string
}

type PromotionEvidenceNote = Awaited<ReturnType<WikiVaultApi['fetchNote']>>['note']
type PromotionPreviewResult = Awaited<ReturnType<WikiVaultApi['previewPromotion']>>
type HealthFinding = Awaited<ReturnType<WikiVaultApi['fetchLint']>>['findings'][number]
type HealthSeverityFilter = 'all' | 'high' | 'medium' | 'low'
type HealthActionQueueTarget = 'notes' | 'evidence' | 'promotion' | 'task-review'
type WikiSearchResult = Awaited<ReturnType<WikiVaultApi['search']>>['results'][number]
type HealthSuggestionMode = '' | 'repair' | 'anchor'

interface HealthActionQueueItem {
  id: string
  title: string
  description: string
  codes: string[]
  target: HealthActionQueueTarget
  targetSection?: 'issues' | 'patterns' | 'syntheses'
  items: HealthFinding[]
  count: number
  severity: HealthFinding['severity']
}

interface HealthSuggestionResult extends WikiSearchResult {
  hint: string
}

const EMPTY_STATS: KnowledgeStatsDto = {
  total: 0,
  draft: 0,
  active: 0,
  archived: 0,
  byType: {
    capture: 0,
    note: 0,
    document: 0,
  },
}

const SUBTYPE_SUGGESTIONS: Record<KnowledgeSourceType, string[]> = {
  capture: ['manual', 'web-clip', 'chat-snippet', 'terminal', 'meeting'],
  note: ['daily-note', 'reflection', 'decision', 'todo', 'hypothesis'],
  document: ['article', 'pdf', 'readme', 'spec', 'meeting-notes'],
}

const INTAKE_STAGE_OPTIONS: Array<{ value: KnowledgeIntakeStage; label: string; description: string }> = [
  { value: 'inbox', label: 'Inbox', description: '刚收进来，还没有判断后续用途。' },
  { value: 'needs-context', label: '补上下文', description: '缺项目、来源、问题背景或证据范围。' },
  { value: 'search-candidate', label: '进主检索', description: '适合作为问答检索材料，但还不急着写 wiki。' },
  { value: 'wiki-candidate', label: '进 Wiki 编译', description: '已经接近 issue / pattern / synthesis 的原料。' },
  { value: 'reference-only', label: '仅参考', description: '保留出处，默认不进入主流程。' },
]

const CONFIDENCE_OPTIONS: Array<{ value: KnowledgeConfidence; label: string; description: string }> = [
  { value: 'low', label: '低', description: '只是一条线索，需要回源确认。' },
  { value: 'medium', label: '中', description: '基本可用，但还缺少独立补证。' },
  { value: 'high', label: '高', description: '来源清楚，内容稳定，可以进入后续流程。' },
]

const TASK_REVIEW_TAB_OPTIONS: Array<{ value: KnowledgeWorkbenchTab; label: string; description: string }> = [
  { value: 'raw', label: 'Raw Inbox', description: '先接住原始材料，做最粗的一轮分流。' },
  { value: 'task-review', label: '任务筛选', description: '先按会话分流，再参考会话内任务段决定是否进入主检索。' },
  { value: 'promotion', label: '升格审核', description: '看哪些候选已经值得升格成 reader-first wiki。' },
  { value: 'health', label: '健康巡检', description: '检查 wiki 结构健康度和长期积压问题。' },
]

const LOW_CONTEXT_PATTERNS = [
  /^可以[，,\s]*(继续|了)?$/u,
  /^继续[吧呀啊]?$/u,
  /^然后呢[？?]?$/u,
  /^这个呢[？?]?$/u,
  /^还有呢[？?]?$/u,
  /^行[吧呀啊]?$/u,
  /^好的?$/u,
  /^嗯[嗯啊哦]?$/u,
  /^ok$/iu,
  /^按照?(刚才|上面|前面)那个/u,
]

const ANSWER_QUESTION_PATTERNS = [
  /为什么/u,
  /如何/u,
  /怎么/u,
  /是否/u,
  /区别/u,
  /怎么判断/u,
  /怎么选/u,
  /should|how|why|compare|comparison|plan|next step|what should/iu,
]

const ANSWER_STRUCTURE_PATTERNS = [
  /(?:^|\n)\s*(?:\d+\.\s|[-*]\s)/u,
  /##\s+/u,
  /总结|结论|建议|推荐|最实用|组合拳|判断方法|鉴别方法|核心思路|关键点/u,
]

const ANSWER_NEGATIVE_PATTERNS = [
  /我来(?:先)?|让我(?:先)?|我先|继续看|继续改|先读|先检查|正在查看/u,
  /\b(?:let me|i(?:'| wi)ll|checking|inspecting|implementing|reading relevant files)\b/iu,
  /\b(?:apply_patch|sed -n|rg -n|npm run|pnpm |git )\b/iu,
]

const HEALTH_ACTION_QUEUE_DEFS: Array<{
  id: string
  title: string
  description: string
  codes: string[]
  target: HealthActionQueueTarget
  targetSection?: 'issues' | 'patterns' | 'syntheses'
}> = [
  {
    id: 'link-repair',
    title: '修链接骨架',
    description: '先处理断链、孤儿页和未锚定概念，阅读层会更稳定。',
    codes: ['broken-wikilink', 'orphan-note', 'concept-unanchored'],
    target: 'evidence',
  },
  {
    id: 'issue-backlog',
    title: '清理 Issue 积压',
    description: '把 stale draft、证据太薄和排障结构不完整的问题推进到 issue 审核流。',
    codes: ['stale-draft-issue', 'thin-issue-evidence', 'issue-incomplete-troubleshooting', 'issue-missing-project'],
    target: 'promotion',
    targetSection: 'issues',
  },
  {
    id: 'pattern-backlog',
    title: '补齐 Pattern / Project 沉淀',
    description: '优先把 pattern 缺口和 project 知识空洞推进到 reader-first 层。',
    codes: ['pattern-incomplete-shape', 'pattern-missing-project', 'project-knowledge-gap', 'project-missing-patterns'],
    target: 'promotion',
    targetSection: 'patterns',
  },
  {
    id: 'page-quality',
    title: '修页面质量',
    description: '弱摘要和重复标题更适合先回看页面，再决定如何整理。',
    codes: ['weak-summary', 'duplicate-title'],
    target: 'notes',
  },
  {
    id: 'context-recheck',
    title: '回源补上下文',
    description: '项目归属不清或证据不足的内容，先回源会话看能否补上下文。',
    codes: ['issue-missing-project', 'pattern-missing-project', 'thin-issue-evidence'],
    target: 'task-review',
  },
]

function toTagsInput(tags: string[]) {
  return (Array.isArray(tags) ? tags : []).join(', ')
}

function parseTagsInput(value: string) {
  return [...new Set(
    String(value || '')
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  )]
}

function inferDefaultSubtype(sourceType: KnowledgeSourceType) {
  return SUBTYPE_SUGGESTIONS[sourceType]?.[0] || 'manual'
}

function normalizeIntakeStage(value: unknown): KnowledgeIntakeStage {
  const normalized = String(value || '').trim()
  return INTAKE_STAGE_OPTIONS.some((item) => item.value === normalized) ? normalized as KnowledgeIntakeStage : 'inbox'
}

function normalizeConfidence(value: unknown): KnowledgeConfidence {
  const normalized = String(value || '').trim()
  return CONFIDENCE_OPTIONS.some((item) => item.value === normalized) ? normalized as KnowledgeConfidence : 'medium'
}

function getKnowledgeMetaString(item: KnowledgeItemDto | null | undefined, key: string) {
  const value = item?.meta?.[key]
  return String(value || '').trim()
}

function buildKnowledgeItemMeta(base: unknown, payload: {
  project: string
  topic: string
  intakeStage: KnowledgeIntakeStage
  confidence: KnowledgeConfidence
  keyQuestion: string
  decisionNote: string
}) {
  const previous = base && typeof base === 'object' && !Array.isArray(base) ? base as Record<string, unknown> : {}
  return {
    ...previous,
    project: payload.project,
    topic: payload.topic,
    intakeStage: payload.intakeStage,
    confidence: payload.confidence,
    keyQuestion: payload.keyQuestion,
    decisionNote: payload.decisionNote,
  }
}

function normalizeFingerprintText(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[，。！？；：“”‘’、,.!?;:"'()[\]{}<>]/g, '')
    .trim()
}

function buildKnowledgeFingerprint(value: unknown) {
  return normalizeFingerprintText(value).slice(0, 360)
}

function buildKnowledgeContentTitle(content: string, fallback = '未命名片段') {
  const firstLine = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  if (!firstLine) return fallback
  return firstLine.slice(0, 60)
}

function parseQuickCaptureBatchEntries(value: unknown) {
  const normalized = String(value || '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const chunks = normalized
    .split(/\n{2,}/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  return chunks.map((content, index) => ({
    id: `batch-${index}`,
    title: buildKnowledgeContentTitle(content, `批量片段 ${index + 1}`),
    content,
  }))
}

function extractContentPreview(text: string) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return '还没有内容，适合先把零散片段粘进来。'
  return normalized.slice(0, 140)
}

function clipText(value: string, limit = 160) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function severityRank(value: string) {
  if (value === 'high') return 3
  if (value === 'medium') return 2
  return 1
}

function normalizeKeyword(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function extractMarkdownSectionText(markdownText: unknown, heading: string) {
  const raw = String(markdownText || '')
  const safeHeading = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = raw.match(new RegExp(`## ${safeHeading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|\\s*$)`))
  return String(match?.[1] || '').trim()
}

function normalizeWikiLinkTarget(target: unknown) {
  const normalized = String(target || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/g, '')
    .replace(/#.*$/g, '')
    .trim()
  if (!normalized) return ''
  return normalized.endsWith('.md') ? normalized : `${normalized}.md`
}

function parseWikiLinkTargets(markdownText: unknown) {
  const seen = new Set<string>()
  const matches = String(markdownText || '').matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)
  for (const match of matches) {
    const target = normalizeWikiLinkTarget(match?.[1] || '')
    if (!target) continue
    seen.add(target)
  }
  return Array.from(seen)
}

function basenameWithoutMarkdown(value: unknown) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/g, '')
    .replace(/\.md$/i, '')
    .trim()
  if (!normalized) return ''
  return normalized.split('/').filter(Boolean).pop() || normalized
}

function tokenizeForSearch(value: unknown) {
  return String(value || '')
    .replace(/\.md$/i, '')
    .split(/[/_\-.]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
}

function dedupeStrings(values: unknown[], limit = 8) {
  const deduped = new Set<string>()
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || '').trim()
    if (!normalized) continue
    deduped.add(normalized)
    if (deduped.size >= limit) break
  }
  return Array.from(deduped)
}

function extractBrokenTarget(detail: unknown) {
  const match = String(detail || '').match(/Links to missing note:\s*(.+)$/i)
  return String(match?.[1] || '').trim()
}

function normalizeProjectName(value: string) {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  return normalized
    .replace(/^\/+/, '')
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() || normalized
}

function extractProjectName(session: SessionItem) {
  const candidates = new Set<string>()
  for (const chunk of Array.isArray(session.matchedChunks) ? session.matchedChunks : []) {
    for (const filePath of Array.isArray(chunk?.filePaths) ? chunk.filePaths : []) {
      const normalized = String(filePath || '')
      const match = normalized.match(/\/([^/]+)\/(?:src|server|docs|scripts|app|components|pages|routes)\//u)
      if (match?.[1]) candidates.add(normalizeProjectName(match[1]))
    }
  }

  for (const tag of Array.isArray(session.tags) ? session.tags : []) {
    if (/^[A-Za-z0-9._-]{3,}$/u.test(String(tag || '')) && !/^(bug|todo|note|chat)$/iu.test(String(tag || ''))) {
      candidates.add(normalizeProjectName(String(tag)))
    }
  }

  const titleMatch = String(session.title || '').match(/(?:\/|^)([A-Za-z0-9._-]{3,})(?:\/(?:src|server|docs|app|components))/u)
  if (titleMatch?.[1]) candidates.add(normalizeProjectName(titleMatch[1]))
  return Array.from(candidates)[0] || ''
}

function getReviewMeta(session: SessionItem, segmentId = '') {
  const normalizedSegmentId = String(segmentId || '').trim()
  const sessionReview = session?.meta?.review || {}
  const segmentReview = normalizedSegmentId
    ? session?.meta?.taskReviewSegments?.[normalizedSegmentId]
    : null
  const fallbackReview = segmentReview && typeof segmentReview === 'object'
    ? segmentReview
    : sessionReview
  const sessionReviewNote = String(sessionReview?.note || '').trim()
  const shouldIgnoreLegacyWorkbenchSessionReview = !segmentReview
    && normalizedSegmentId
    && /knowledge-workbench:/u.test(sessionReviewNote)
  const review = shouldIgnoreLegacyWorkbenchSessionReview ? {} : fallbackReview
  const note = String(review.note || '').trim()
  return {
    status: (String(review.status || 'pending') as SessionReviewStatus),
    keepInSearch: review.keepInSearch === true,
    qualityScore: Number.isFinite(Number(review.qualityScore)) ? Number(review.qualityScore) : null,
    note,
    isPromoteCandidate: /knowledge-workbench:\s*promote-candidate/u.test(note),
  }
}

function getFirstUserIntent(session: SessionItem) {
  const message = (Array.isArray(session.messages) ? session.messages : [])
    .find((item) => String(item?.role || '').toLowerCase() === 'user')
  return clipText(String(message?.content || ''), 180)
}

function getLatestAssistantReply(session: SessionItem) {
  const list = (Array.isArray(session.messages) ? session.messages : [])
    .filter((item) => String(item?.role || '').toLowerCase() === 'assistant')
  return clipText(String(list[list.length - 1]?.content || ''), 220)
}

function extractAssistantReplies(messages: SessionItem['messages'] | TaskSegmentSlice['messages'], limit = 5) {
  return (Array.isArray(messages) ? messages : [])
    .filter((item) => getMessageRole(item?.role) === 'assistant')
    .map((item) => clipText(String(item?.content || ''), 320))
    .filter(Boolean)
    .slice(-limit)
}

function getMessageRole(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function getSegmentCorpus(segment: Pick<TaskSegmentSlice, 'messages'>) {
  return (Array.isArray(segment?.messages) ? segment.messages : [])
    .map((item) => String(item?.content || ''))
    .join('\n')
}

function extractFileHints(value: string) {
  const matches = new Set<string>()
  const source = String(value || '')
  for (const match of source.matchAll(/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+(?:\.[A-Za-z0-9_-]+)?/g)) {
    const normalized = String(match[0] || '').trim()
    if (normalized) matches.add(normalized.toLowerCase())
  }
  for (const match of source.matchAll(/\b[A-Za-z0-9._-]+\.(?:ts|tsx|js|jsx|vue|mjs|cjs|json|md|css|scss|html)\b/g)) {
    const normalized = String(match[0] || '').trim()
    if (normalized) matches.add(normalized.toLowerCase())
  }
  return matches
}

function hasFollowUpCue(value: string) {
  return /^(继续|然后|接着|再看|再改|这里|这个|这个地方|那这里|那现在|现在|所以|基于这个|按这个|照这个|顺着这个)/u
    .test(String(value || '').trim())
}

function hasExplicitTopicShift(value: string) {
  return /^(另外|另一个|换个|再问一个|新问题|顺便|题外话|切到|回到另外一个)/u
    .test(String(value || '').trim())
}

function areTaskTypesCompatible(left: TaskReviewType, right: TaskReviewType) {
  if (left === right) return true
  const productTypes = new Set<TaskReviewType>([
    'bug-investigation',
    'coding-task',
    'architecture-discussion',
    'prompt-design',
  ])
  if (productTypes.has(left) && productTypes.has(right)) return true
  if (left === 'context-fragment' || right === 'context-fragment') return true
  return false
}

function buildTaskTurnSegments(session: SessionItem): TaskSegmentSlice[] {
  const messages = Array.isArray(session.messages) ? session.messages : []
  const userIndexes = messages
    .map((item, index) => ({ role: getMessageRole(item?.role), index }))
    .filter((item) => item.role === 'user')
    .map((item) => item.index)

  if (!userIndexes.length) {
    return [{
      id: `${session.id}::segment-1`,
      index: 0,
      total: 1,
      messages,
      firstUserIntent: '',
      latestAssistantReply: clipText(
        String(messages.filter((item) => getMessageRole(item?.role) === 'assistant').slice(-1)[0]?.content || ''),
        220,
      ),
    }]
  }

  return userIndexes.map((userIndex, segmentIndex) => {
    const nextUserIndex = userIndexes[segmentIndex + 1]
    const startIndex = segmentIndex === 0 ? 0 : userIndex
    const endIndex = typeof nextUserIndex === 'number' ? nextUserIndex - 1 : messages.length - 1
    const segmentMessages = messages.slice(startIndex, endIndex + 1)
    const firstUserIntent = clipText(String(messages[userIndex]?.content || ''), 180)
    const latestAssistantReply = clipText(
      String(segmentMessages.filter((item) => getMessageRole(item?.role) === 'assistant').slice(-1)[0]?.content || ''),
      220,
    )
    return {
      id: `${session.id}::segment-${segmentIndex + 1}`,
      index: segmentIndex,
      total: userIndexes.length,
      messages: segmentMessages,
      firstUserIntent,
      latestAssistantReply,
    }
  })
}

function shouldMergeTaskSegments(session: SessionItem, previous: TaskSegmentSlice, next: TaskSegmentSlice) {
  if (hasExplicitTopicShift(next.firstUserIntent)) return false

  const previousCorpus = [previous.firstUserIntent, previous.latestAssistantReply, getSegmentCorpus(previous)].join('\n')
  const nextCorpus = [next.firstUserIntent, next.latestAssistantReply, getSegmentCorpus(next)].join('\n')
  const previousType = inferTaskType(session, previous.firstUserIntent, previous.latestAssistantReply, previousCorpus)
  const nextType = inferTaskType(session, next.firstUserIntent, next.latestAssistantReply, nextCorpus)
  const previousFiles = extractFileHints(previousCorpus)
  const nextFiles = extractFileHints(nextCorpus)
  const hasSharedFiles = Array.from(previousFiles).some((file) => nextFiles.has(file))
  const nextLowContext = LOW_CONTEXT_PATTERNS.some((pattern) => pattern.test(next.firstUserIntent))
  const nextFollowUp = hasFollowUpCue(next.firstUserIntent)
  const sameProject = Boolean(extractProjectName(session))
  const previousCodeHeavy = countCodeSignals(previousCorpus) >= 2
  const nextCodeHeavy = countCodeSignals(nextCorpus) >= 2
  const compatibleTypes = areTaskTypesCompatible(previousType, nextType)

  let score = 0
  if (hasSharedFiles) score += 3
  if (nextLowContext || nextFollowUp) score += 2
  if (previousType === nextType) score += 2
  else if (compatibleTypes) score += 1
  if (sameProject && previousCodeHeavy && nextCodeHeavy) score += 1
  if (next.firstUserIntent.length <= 24) score += 1
  if (!compatibleTypes) score -= 2
  if ((previousType === 'general-knowledge') !== (nextType === 'general-knowledge')) score -= 1
  if ((previousType === 'chitchat') !== (nextType === 'chitchat')) score -= 2

  const hasCarrySignal = hasSharedFiles || nextLowContext || nextFollowUp || (sameProject && compatibleTypes && (previousCodeHeavy || nextCodeHeavy))
  return hasCarrySignal && score >= 3
}

function mergeTaskSegments(parts: TaskSegmentSlice[]) {
  return parts.reduce<TaskSegmentSlice | null>((merged, part) => {
    if (!merged) return { ...part, messages: Array.isArray(part.messages) ? part.messages.slice() : [] }
    return {
      ...merged,
      messages: [...(Array.isArray(merged.messages) ? merged.messages : []), ...(Array.isArray(part.messages) ? part.messages : [])],
      latestAssistantReply: part.latestAssistantReply || merged.latestAssistantReply,
    }
  }, null)
}

function buildTaskSegments(session: SessionItem) {
  const turnSegments = buildTaskTurnSegments(session)
  if (turnSegments.length <= 1) return turnSegments

  const mergedSegments: TaskSegmentSlice[] = []
  for (const segment of turnSegments) {
    const previous = mergedSegments[mergedSegments.length - 1]
    if (previous && shouldMergeTaskSegments(session, previous, segment)) {
      const nextMerged = mergeTaskSegments([previous, segment])
      if (nextMerged) mergedSegments[mergedSegments.length - 1] = nextMerged
      continue
    }
    mergedSegments.push({ ...segment, messages: Array.isArray(segment.messages) ? segment.messages.slice() : [] })
  }

  const total = mergedSegments.length
  return mergedSegments.map((segment, index) => ({
    ...segment,
    id: `${session.id}::segment-${index + 1}`,
    index,
    total,
  }))
}

function countCodeSignals(value: string) {
  const text = String(value || '')
  const patterns = [
    /```/u,
    /\b(?:const|let|function|return|import|export|await|async|npm|pnpm|node|vue|react|typescript|js|ts)\b/iu,
    /(?:src|server|docs|scripts|components|pages|routes)\/[^\s]+/u,
    /\b(?:error|exception|trace|stack|bug|fix|lint|build|compile|deploy)\b/iu,
  ]
  return patterns.filter((pattern) => pattern.test(text)).length
}

function scoreAnswerCandidate(reply: string, firstUserIntent: string) {
  const normalizedReply = String(reply || '').replace(/\s+/g, ' ').trim()
  if (!normalizedReply) return -Infinity

  let score = 0
  if (normalizedReply.length >= 240) score += 4
  else if (normalizedReply.length >= 140) score += 3
  else if (normalizedReply.length >= 80) score += 2

  if (ANSWER_STRUCTURE_PATTERNS.some((pattern) => pattern.test(reply))) score += 4
  if (ANSWER_QUESTION_PATTERNS.some((pattern) => pattern.test(firstUserIntent))) score += 2
  if (ANSWER_NEGATIVE_PATTERNS.some((pattern) => pattern.test(normalizedReply))) score -= 5
  if (countCodeSignals(reply) >= 3) score -= 2
  if (/^(可以|好的|行|继续|我来)/u.test(normalizedReply)) score -= 2

  return score
}

function pickBestAssistantAnswer(replies: string[], firstUserIntent: string, latestAssistantReply = '') {
  const candidates = (Array.isArray(replies) ? replies : []).filter(Boolean)
  if (!candidates.length) return String(latestAssistantReply || '').trim()

  const ranked = candidates
    .map((reply) => ({ reply, score: scoreAnswerCandidate(reply, firstUserIntent) }))
    .sort((a, b) => b.score - a.score || b.reply.length - a.reply.length)

  if ((ranked[0]?.score ?? -Infinity) < 2) {
    return String(latestAssistantReply || ranked[0]?.reply || '').trim()
  }
  return String(ranked[0]?.reply || latestAssistantReply || '').trim()
}

function scoreAnswerEssence(options: {
  provider: string
  taskType: TaskReviewType
  firstUserIntent: string
  latestAssistantReply: string
  bestAssistantAnswer: string
  project: string
  codeSignals: number
  messageCount: number
}) {
  const provider = String(options.provider || '').trim().toLowerCase()
  const userIntent = String(options.firstUserIntent || '').trim()
  const bestAnswer = String(options.bestAssistantAnswer || options.latestAssistantReply || '').trim()
  let score = 10

  if (ANSWER_QUESTION_PATTERNS.some((pattern) => pattern.test(userIntent))) score += 28
  if (ANSWER_STRUCTURE_PATTERNS.some((pattern) => pattern.test(bestAnswer))) score += 22
  if (bestAnswer.length >= 220) score += 16
  else if (bestAnswer.length >= 120) score += 10
  else if (bestAnswer.length >= 80) score += 6

  if (provider === 'codex' || provider === 'cursor') score += 8
  if (options.taskType === 'general-knowledge') score += 10
  if (options.taskType === 'architecture-discussion') score += 8
  if (options.taskType === 'prompt-design') score += 6
  if (options.project) score += 4
  if (options.messageCount >= 4) score += 4
  if (options.codeSignals >= 4) score -= 6
  else if (options.codeSignals >= 2) score -= 3
  if (options.taskType === 'bug-investigation') score -= 18
  if (ANSWER_NEGATIVE_PATTERNS.some((pattern) => pattern.test(bestAnswer))) score -= 18

  return clampScore(score)
}

function buildAnswerEssenceReasons(options: {
  taskType: TaskReviewType
  firstUserIntent: string
  bestAssistantAnswer: string
  project: string
  answerScore: number
  codeSignals: number
  messageCount: number
}) {
  const reasons: string[] = []
  const intent = String(options.firstUserIntent || '')
  const bestAnswer = String(options.bestAssistantAnswer || '')

  if (options.answerScore >= 64) reasons.push('回答精华分已过阈值')
  else if (options.answerScore >= 56) reasons.push('回答有沉淀潜力')
  if (ANSWER_QUESTION_PATTERNS.some((pattern) => pattern.test(intent))) reasons.push('起始问题是明确问答')
  if (ANSWER_STRUCTURE_PATTERNS.some((pattern) => pattern.test(bestAnswer))) reasons.push('回答结构清晰')
  if (bestAnswer.length >= 220) reasons.push('答案信息量较足')
  else if (bestAnswer.length >= 120) reasons.push('答案长度适合复核')
  if (['general-knowledge', 'architecture-discussion', 'prompt-design'].includes(options.taskType)) reasons.push('任务类型偏长期知识')
  if (options.project) reasons.push('项目归属可定位')
  if (options.messageCount >= 4) reasons.push('上下文轮次足够')
  if (options.codeSignals >= 4) reasons.push('代码过程信号偏重，升格前需复核')
  if (ANSWER_NEGATIVE_PATTERNS.some((pattern) => pattern.test(bestAnswer))) reasons.push('包含过程性回复，建议人工扫一眼')

  return dedupeStrings(reasons, 5)
}

function buildPromotionRouteHint(target: PromotionTargetKind, isAnswerEssence: boolean) {
  if (target === 'issue-review') return '送审后进入 Issue Review，先确认问题、原因和修复路径是否稳定。'
  if (target === 'pattern-candidate') return '送审后进入 Pattern Candidate，重点看复用形状和适用边界。'
  if (target === 'synthesis-candidate' && isAnswerEssence) return '送审后进入 Synthesis Candidate，优先沉淀成 reader-first 问答结论页。'
  return '送审后进入 Synthesis Candidate，先判断这段回答是否足够长期可读。'
}

function inferTaskType(session: SessionItem, firstUserIntent: string, latestAssistantReply: string, segmentCorpus = ''): TaskReviewType {
  const corpus = [session.title, firstUserIntent, latestAssistantReply, segmentCorpus, ...(session.tags || [])].join('\n')
  const normalized = String(corpus || '')

  if (LOW_CONTEXT_PATTERNS.some((pattern) => pattern.test(firstUserIntent))) return 'context-fragment'
  if (/(bug|报错|异常|修复|定位|无响应|没反应|故障|crash|error|trace)/iu.test(normalized)) return 'bug-investigation'
  if (/(架构|设计|方案|tradeoff|取舍|抽象|拆分|workflow|pipeline|schema)/iu.test(normalized)) return 'architecture-discussion'
  if (/(prompt|提示词|system prompt|instruction|优化 prompt|agent)/iu.test(normalized)) return 'prompt-design'
  if (countCodeSignals(normalized) >= 2) return 'coding-task'
  if (/(天气|饮食|翻译|常识|怎么说|百科|区别|定义|生活)/u.test(normalized)) return 'general-knowledge'
  if (normalized.length <= 48) return 'chitchat'
  return 'general-knowledge'
}

function predictPromotionTarget(
  session: SessionItem,
  taskType: TaskReviewType,
  firstUserIntent: string,
  latestAssistantReply: string,
  segmentCorpus = '',
  answerValue = 0,
  bestAssistantAnswer = '',
): PromotionTargetKind {
  const combined = [session.title, firstUserIntent, bestAssistantAnswer || latestAssistantReply, segmentCorpus, ...(session.tags || [])]
    .filter(Boolean)
    .join('\n')
  const normalized = String(combined || '')

  const hasIssueSignal = /(bug|报错|错误|异常|修复|定位|无响应|没反应|故障|crash|error|trace|failed|fallback|timeout|根因)/iu.test(normalized)
  if (taskType === 'bug-investigation' || hasIssueSignal) return 'issue-review'

  const hasQuestionIntent = ANSWER_QUESTION_PATTERNS.some((pattern) => pattern.test(firstUserIntent))
  if (answerValue >= 64 && hasQuestionIntent) return 'synthesis-candidate'

  const hasPatternSignal = /(架构|设计|方案|tradeoff|取舍|抽象|拆分|workflow|pipeline|schema|模式|pattern|最佳实践|规范|机制|复用)/iu.test(normalized)
  if (taskType === 'architecture-discussion' || (taskType === 'prompt-design' && hasPatternSignal) || hasPatternSignal) {
    return 'pattern-candidate'
  }

  return 'synthesis-candidate'
}

function buildTaskReviewItemFromSegment(session: SessionItem, segment: TaskSegmentSlice): TaskReviewItem {
  const review = getReviewMeta(session, segment.id)
  const firstUserIntent = String(segment?.firstUserIntent || getFirstUserIntent(session))
  const latestAssistantReply = String(segment?.latestAssistantReply || getLatestAssistantReply(session))
  const segmentCorpus = getSegmentCorpus(segment)
  const taskType = inferTaskType(session, firstUserIntent, latestAssistantReply, segmentCorpus)
  const project = extractProjectName(session)
  const messageCount = Array.isArray(segment?.messages) ? segment.messages.length : 0
  const sessionMessageCount = Array.isArray(session.messages) ? session.messages.length : 0
  const codeSignals = countCodeSignals([session.title, firstUserIntent, latestAssistantReply, segmentCorpus].join('\n'))
  const assistantReplies = extractAssistantReplies(segment?.messages)
  const bestAssistantAnswer = pickBestAssistantAnswer(assistantReplies, firstUserIntent, latestAssistantReply)
  const isLowContext = LOW_CONTEXT_PATTERNS.some((pattern) => pattern.test(firstUserIntent))
  const segmentLabel = `任务段 ${Number(segment?.index || 0) + 1}/${Math.max(1, Number(segment?.total || 1))}`
  const segmentTitle = clipText(firstUserIntent || String(session.title || '').trim() || '未命名任务', 72)

  let contextCompleteness = 34
  if (segmentTitle.length >= 8) contextCompleteness += 12
  if (firstUserIntent.length >= 18) contextCompleteness += 18
  if (latestAssistantReply.length >= 48) contextCompleteness += 14
  if (messageCount >= 4) contextCompleteness += 10
  if (project) contextCompleteness += 8
  if (codeSignals >= 2) contextCompleteness += 8
  if (isLowContext) contextCompleteness -= 28
  const contextScore = clampScore(contextCompleteness)

  let retrievalValue = 18
  if (taskType === 'bug-investigation') retrievalValue += 42
  else if (taskType === 'coding-task') retrievalValue += 36
  else if (taskType === 'architecture-discussion') retrievalValue += 28
  else if (taskType === 'prompt-design') retrievalValue += 24
  else if (taskType === 'general-knowledge') retrievalValue += 10
  retrievalValue += Math.round(contextScore * 0.22)
  retrievalValue += codeSignals * 6
  if (project) retrievalValue += 10
  if (review.keepInSearch) retrievalValue += 12
  const retrievalScore = clampScore(retrievalValue)

  const answerScore = scoreAnswerEssence({
    provider: String(session.provider || ''),
    taskType,
    firstUserIntent,
    latestAssistantReply,
    bestAssistantAnswer,
    project,
    codeSignals,
    messageCount,
  })
  const isAnswerEssence = answerScore >= 64

  let promotionValue = 8
  if (taskType === 'bug-investigation') promotionValue += 34
  else if (taskType === 'architecture-discussion') promotionValue += 30
  else if (taskType === 'prompt-design') promotionValue += 24
  else if (taskType === 'coding-task') promotionValue += 20
  promotionValue += Math.round(contextScore * 0.2)
  promotionValue += codeSignals * 5
  if (answerScore >= 64) promotionValue += 10
  else if (answerScore >= 60) promotionValue += 5
  if (project) promotionValue += 8
  if (messageCount >= 6) promotionValue += 8
  if (isLowContext) promotionValue -= 24
  if (taskType === 'general-knowledge' && !project) promotionValue -= 12
  const promotionScore = clampScore(promotionValue)

  const predictedPromotionTarget = predictPromotionTarget(
    session,
    taskType,
    firstUserIntent,
    latestAssistantReply,
    segmentCorpus,
    answerScore,
    bestAssistantAnswer,
  )
  const answerEssenceReasons = buildAnswerEssenceReasons({
    taskType,
    firstUserIntent,
    bestAssistantAnswer,
    project,
    answerScore,
    codeSignals,
    messageCount,
  })
  const promotionRouteHint = buildPromotionRouteHint(predictedPromotionTarget, isAnswerEssence)

  let noiseRisk = 16
  if (taskType === 'context-fragment') noiseRisk += 42
  if (taskType === 'chitchat') noiseRisk += 28
  if (taskType === 'general-knowledge' && !project) noiseRisk += 16
  if (firstUserIntent.length <= 8) noiseRisk += 14
  if (contextScore <= 35) noiseRisk += 18
  if (codeSignals >= 2) noiseRisk -= 10
  if (review.keepInSearch) noiseRisk -= 6
  const noiseScore = clampScore(noiseRisk)

  let recommendedAction: TaskReviewAction = 'archive-only'
  if (isLowContext && contextScore <= 38) recommendedAction = 'needs-context'
  else if (noiseScore >= 78 && retrievalScore < 45) recommendedAction = 'ignore-noise'
  else if (promotionScore >= 68) recommendedAction = 'promote-candidate'
  else if (answerScore >= 64 && contextScore >= 52) recommendedAction = 'promote-candidate'
  else if (retrievalScore >= 60) recommendedAction = 'keep-search'

  const reasoningParts = [
    contextScore <= 38 ? '上下文依赖较重' : '上下文相对完整',
    Number(segment?.total || 1) > 1 ? `${segmentLabel} 已单独切出` : '单轮任务入口较明显',
    project ? `已识别项目 ${project}` : '项目归属仍不稳定',
    retrievalScore >= 60 ? '适合参与主检索' : '更适合降级处理',
    promotionScore >= 68 ? '值得进入升格候选' : '先留在证据层更稳',
    answerScore >= 64 ? '回答精华信号明显' : answerScore >= 56 ? '回答有沉淀价值' : '回答更偏过程性',
  ]

  return {
    id: segment.id,
    sessionId: session.id,
    sessionTitle: String(session.title || '').trim() || '未命名会话',
    segmentIndex: Number(segment?.index || 0),
    segmentCount: Math.max(1, Number(segment?.total || 1)),
    segmentLabel,
    title: segmentTitle,
    provider: String(session.provider || '').trim() || 'unknown',
    updatedAt: String(session.updatedAt || ''),
    tags: Array.isArray(session.tags) ? session.tags : [],
    project,
    firstUserIntent,
    latestAssistantReply,
    bestAssistantAnswer,
    reviewStatus: review.status,
    isPromoteCandidate: review.isPromoteCandidate,
    keepInSearch: review.keepInSearch,
    qualityScore: review.qualityScore,
    taskType,
    contextCompleteness: contextScore,
    retrievalValue: retrievalScore,
    promotionValue: promotionScore,
    answerValue: answerScore,
    noiseRisk: noiseScore,
    isAnswerEssence,
    answerEssenceReasons,
    recommendedAction,
    predictedPromotionTarget,
    promotionRouteHint,
    reasoning: reasoningParts.join(' · '),
    messageCount,
    sessionMessageCount,
  }
}

function getTaskReviewPriority(item: TaskReviewItem) {
  const actionPriority: Record<TaskReviewAction, number> = {
    'promote-candidate': 5,
    'keep-search': 4,
    'archive-only': 3,
    'needs-context': 2,
    'ignore-noise': 1,
  }
  return (
    actionPriority[item.recommendedAction] * 1000
    + item.promotionValue * 5
    + item.retrievalValue * 4
    + item.answerValue * 3
    + item.contextCompleteness * 2
    - item.noiseRisk
  )
}

function buildTaskReviewSessionGroup(session: SessionItem): TaskReviewSessionGroup {
  const segments = buildTaskSegments(session).map((segment) => buildTaskReviewItemFromSegment(session, segment))
  const primarySegment = segments
    .slice()
    .sort((left, right) => getTaskReviewPriority(right) - getTaskReviewPriority(left))[0]
    || buildTaskReviewItemFromSegment(session, buildTaskSegments(session)[0])
  const fallbackReview = getReviewMeta(session)
  const groupReview = primarySegment
    ? {
        status: primarySegment.reviewStatus,
        isPromoteCandidate: primarySegment.isPromoteCandidate,
        keepInSearch: primarySegment.keepInSearch,
        qualityScore: primarySegment.qualityScore,
      }
    : fallbackReview
  const project = primarySegment?.project || extractProjectName(session)
  const taskTypes = Array.from(new Set(segments.map((segment) => segment.taskType)))
  const reasoningParts = [
    segments.length > 1 ? `自动合并为 ${segments.length} 个连续任务段` : '当前会话看起来仍是单条连续任务',
    primarySegment?.recommendedAction === 'promote-candidate' ? '主任务段已接近升格门槛' : '主任务段更适合先做筛选分流',
    project ? `项目归属偏向 ${project}` : '项目归属仍需人工确认',
  ]

  return {
    id: String(session.id || '').trim(),
    title: String(session.title || '').trim() || '未命名会话',
    provider: String(session.provider || '').trim() || 'unknown',
    updatedAt: String(session.updatedAt || ''),
    tags: Array.isArray(session.tags) ? session.tags : [],
    project,
    reviewStatus: groupReview.status,
    isPromoteCandidate: groupReview.isPromoteCandidate,
    keepInSearch: groupReview.keepInSearch,
    qualityScore: groupReview.qualityScore,
    segmentCount: segments.length,
    taskTypes,
    primarySegmentId: primarySegment.id,
    primarySegmentTitle: primarySegment.title,
    primaryTaskType: primarySegment.taskType,
    primaryRecommendedAction: primarySegment.recommendedAction,
    primaryContextCompleteness: primarySegment.contextCompleteness,
    primaryRetrievalValue: primarySegment.retrievalValue,
    primaryPromotionValue: primarySegment.promotionValue,
    primaryAnswerValue: primarySegment.answerValue,
    primaryIsAnswerEssence: primarySegment.isAnswerEssence,
    primaryNoiseRisk: primarySegment.noiseRisk,
    reasoning: reasoningParts.join(' · '),
    segments,
  }
}

function buildVisibleTaskReviewSessionGroup(
  session: TaskReviewSessionGroup,
  visibleSegments: TaskReviewItem[],
): TaskReviewSessionGroup {
  const segments = Array.isArray(visibleSegments) ? visibleSegments : []
  const primarySegment = segments
    .slice()
    .sort((left, right) => getTaskReviewPriority(right) - getTaskReviewPriority(left))[0]
    || session.segments[0]

  return {
    ...session,
    project: primarySegment?.project || session.project,
    reviewStatus: primarySegment?.reviewStatus || session.reviewStatus,
    isPromoteCandidate: primarySegment?.isPromoteCandidate || false,
    keepInSearch: primarySegment?.keepInSearch || false,
    qualityScore: primarySegment?.qualityScore ?? null,
    segmentCount: segments.length,
    taskTypes: Array.from(new Set(segments.map((segment) => segment.taskType))),
    primarySegmentId: primarySegment?.id || session.primarySegmentId,
    primarySegmentTitle: primarySegment?.title || session.primarySegmentTitle,
    primaryTaskType: primarySegment?.taskType || session.primaryTaskType,
    primaryRecommendedAction: primarySegment?.recommendedAction || session.primaryRecommendedAction,
    primaryContextCompleteness: primarySegment?.contextCompleteness || session.primaryContextCompleteness,
    primaryRetrievalValue: primarySegment?.retrievalValue || session.primaryRetrievalValue,
    primaryPromotionValue: primarySegment?.promotionValue || session.primaryPromotionValue,
    primaryAnswerValue: primarySegment?.answerValue || session.primaryAnswerValue,
    primaryIsAnswerEssence: primarySegment?.isAnswerEssence || false,
    primaryNoiseRisk: primarySegment?.noiseRisk || session.primaryNoiseRisk,
    reasoning: segments.length === session.segments.length
      ? session.reasoning
      : `按当前筛选保留 ${segments.length} 个任务段 · ${session.reasoning}`,
    segments,
  }
}

export function useKnowledgeSourcesDomain(options: UseKnowledgeSourcesDomainOptions) {
  const knowledgeItems = ref<KnowledgeItemDto[]>([])
  const knowledgeStats = ref<KnowledgeStatsDto>({ ...EMPTY_STATS, byType: { ...EMPTY_STATS.byType } })
  const knowledgeLoading = ref(false)
  const knowledgeSaving = ref(false)
  const selectedKnowledgeItemId = ref('')
  const knowledgeSourceTypeFilter = ref<KnowledgeSourceTypeFilter>('all')
  const knowledgeStatusFilter = ref<KnowledgeStatusFilter>('all')
  const knowledgeIntakeStageFilter = ref<KnowledgeIntakeStageFilter>('all')
  const knowledgeConfidenceFilter = ref<KnowledgeConfidenceFilter>('all')
  const knowledgeKeyword = ref('')
  const workbenchTab = ref<KnowledgeWorkbenchTab>('raw')

  const editorId = ref('')
  const editorSourceType = ref<KnowledgeSourceType>('capture')
  const editorSourceSubtype = ref(inferDefaultSubtype('capture'))
  const editorStatus = ref<KnowledgeStatus>('draft')
  const editorTitle = ref('')
  const editorContent = ref('')
  const editorSourceUrl = ref('')
  const editorSourceFile = ref('')
  const editorTagsInput = ref('')
  const editorProject = ref('')
  const editorTopic = ref('')
  const editorIntakeStage = ref<KnowledgeIntakeStage>('inbox')
  const editorConfidence = ref<KnowledgeConfidence>('medium')
  const editorKeyQuestion = ref('')
  const editorDecisionNote = ref('')
  const quickCaptureOpen = ref(false)
  const quickCaptureSaving = ref(false)
  const quickCaptureMode = ref<QuickCaptureMode>('single')
  const quickCaptureSourceType = ref<KnowledgeSourceType>('capture')
  const quickCaptureTitle = ref('')
  const quickCaptureContent = ref('')
  const quickCaptureSourceUrl = ref('')
  const quickCaptureTagsInput = ref('')
  const quickCaptureMarkActive = ref(false)
  const quickCaptureProject = ref('')
  const quickCaptureTopic = ref('')
  const quickCaptureIntakeStage = ref<KnowledgeIntakeStage>('inbox')
  const quickCaptureConfidence = ref<KnowledgeConfidence>('medium')
  const quickCaptureDecisionNote = ref('')

  const taskReviewLoading = ref(false)
  const taskReviewUpdatingId = ref('')
  const taskReviewKeyword = ref('')
  const taskReviewProviderFilter = ref('all')
  const taskReviewStatusFilter = ref<TaskReviewStatusFilter>('pending')
  const taskReviewTypeFilter = ref<TaskReviewTypeFilter>('all')
  const taskReviewActionFilter = ref<TaskReviewActionFilter>('all')
  const taskReviewAnswerFilter = ref<TaskReviewAnswerFilter>('all')
  const taskReviewPromotionTargetFilter = ref<TaskReviewPromotionTargetFilter>('all')
  const taskReviewSessionsRaw = ref<SessionItem[]>([])
  const selectedTaskReviewSessionId = ref('')
  const selectedTaskReviewSegmentId = ref('')

  const promotionQueueLoading = ref(false)
  const promotionQueue = ref<Awaited<ReturnType<WikiVaultApi['fetchPromotionQueue']>> | null>(null)
  const promotionApplyingKey = ref('')
  const promotionPreviewOpen = ref(false)
  const promotionPreviewLoading = ref(false)
  const promotionPreviewError = ref('')
  const promotionPreviewData = ref<PromotionPreviewResult | null>(null)
  const promotionViewerOpen = ref(false)
  const promotionViewerLoading = ref(false)
  const promotionViewerError = ref('')
  const promotionViewerTitle = ref('')
  const promotionViewerPaths = ref<string[]>([])
  const promotionViewerNotes = ref<PromotionEvidenceNote[]>([])

  const healthLoading = ref(false)
  const wikiHealth = ref<Awaited<ReturnType<WikiVaultApi['fetchLint']>> | null>(null)
  const healthSeverityFilter = ref<HealthSeverityFilter>('all')
  const healthCodeFilter = ref('all')
  const healthKeyword = ref('')
  const selectedHealthFindingKey = ref('')
  const healthSuggestionLoading = ref(false)
  const healthSuggestionError = ref('')
  const healthSuggestionMode = ref<HealthSuggestionMode>('')
  const healthSuggestionKey = ref('')
  const healthSuggestionTitle = ref('')
  const healthSuggestionDescription = ref('')
  const healthSuggestionQuery = ref('')
  const healthSuggestionResults = ref<HealthSuggestionResult[]>([])
  const healthBatchActionLoading = ref(false)
  const healthBatchActionLabel = ref('')
  const healthRepairApplyingTarget = ref('')

  const sourceTypeOptions = [
    { value: 'capture' as const, label: 'Capture', description: '零散片段、网页摘录、聊天摘录、命令输出' },
    { value: 'note' as const, label: 'Note', description: '你自己的判断、灵感、结论、待验证猜想' },
    { value: 'document' as const, label: 'Document', description: '更完整的文档、方案、README、会议纪要' },
  ]

  const statusOptions = [
    { value: 'draft' as const, label: 'Draft' },
    { value: 'active' as const, label: 'Active' },
    { value: 'archived' as const, label: 'Archived' },
  ]
  const intakeStageOptions = INTAKE_STAGE_OPTIONS
  const confidenceOptions = CONFIDENCE_OPTIONS

  const subtypeSuggestions = computed(() => SUBTYPE_SUGGESTIONS[editorSourceType.value] || [])
  const selectedKnowledgeItem = computed(() =>
    knowledgeItems.value.find((item) => item.id === selectedKnowledgeItemId.value) || null,
  )
  const filteredKnowledgeItems = computed(() =>
    knowledgeItems.value.filter((item) => {
      if (knowledgeIntakeStageFilter.value !== 'all' && normalizeIntakeStage(item?.meta?.intakeStage) !== knowledgeIntakeStageFilter.value) {
        return false
      }
      if (knowledgeConfidenceFilter.value !== 'all' && normalizeConfidence(item?.meta?.confidence) !== knowledgeConfidenceFilter.value) {
        return false
      }
      return true
    }),
  )
  const editorIntakeStageOption = computed(() =>
    intakeStageOptions.find((item) => item.value === editorIntakeStage.value) || intakeStageOptions[0],
  )
  const editorConfidenceOption = computed(() =>
    confidenceOptions.find((item) => item.value === editorConfidence.value) || confidenceOptions[1],
  )
  const editorIntakeSummary = computed(() => {
    const project = String(editorProject.value || '').trim()
    const topic = String(editorTopic.value || '').trim()
    const question = String(editorKeyQuestion.value || '').trim()
    const parts = [
      editorIntakeStageOption.value?.label ? `去向：${editorIntakeStageOption.value.label}` : '',
      editorConfidenceOption.value?.label ? `可信度：${editorConfidenceOption.value.label}` : '',
      project ? `项目：${project}` : '项目待确认',
      topic ? `主题：${topic}` : '',
      question ? `问题：${clipText(question, 72)}` : '',
    ].filter(Boolean)
    return parts.join(' · ')
  })

  const rawSummaryCards = computed(() => ([
    {
      id: 'capture',
      title: '零散片段',
      count: knowledgeStats.value.byType.capture,
      description: '先接住一段话、一段日志或一个链接',
    },
    {
      id: 'note',
      title: '主观笔记',
      count: knowledgeStats.value.byType.note,
      description: '把你的判断和假设与原始事实分层保存',
    },
    {
      id: 'document',
      title: '完整文档',
      count: knowledgeStats.value.byType.document,
      description: '面向长期沉淀的正式材料入口',
    },
    {
      id: 'active',
      title: '活跃条目',
      count: knowledgeStats.value.active,
      description: '后续最适合被编译进 wiki 的候选',
    },
    {
      id: 'needs-context',
      title: '待补上下文',
      count: knowledgeItems.value.filter((item) => normalizeIntakeStage(item?.meta?.intakeStage) === 'needs-context').length,
      description: '先补项目、来源和核心问题',
    },
    {
      id: 'wiki-candidate',
      title: 'Wiki 原料',
      count: knowledgeItems.value.filter((item) => normalizeIntakeStage(item?.meta?.intakeStage) === 'wiki-candidate').length,
      description: '下一步可进入编译和升格',
    },
  ]))

  const taskReviewSessions = computed(() =>
    taskReviewSessionsRaw.value
      .map((session) => buildTaskReviewSessionGroup(session))
      .sort((a, b) => +new Date(b.updatedAt || 0) - +new Date(a.updatedAt || 0)),
  )

  const filteredTaskReviewSessions = computed(() => {
    const keyword = String(taskReviewKeyword.value || '').trim().toLowerCase()
    return taskReviewSessions.value
      .map((session) => {
        const visibleSegments = session.segments.filter((segment) => {
          if (taskReviewStatusFilter.value !== 'all' && segment.reviewStatus !== taskReviewStatusFilter.value) return false
          if (taskReviewTypeFilter.value !== 'all' && segment.taskType !== taskReviewTypeFilter.value) return false
          if (taskReviewActionFilter.value !== 'all' && segment.recommendedAction !== taskReviewActionFilter.value) return false
          if (taskReviewAnswerFilter.value === 'essence' && !segment.isAnswerEssence) return false
          if (taskReviewAnswerFilter.value === 'non-essence' && segment.isAnswerEssence) return false
          if (taskReviewPromotionTargetFilter.value !== 'all' && segment.predictedPromotionTarget !== taskReviewPromotionTargetFilter.value) return false
          return true
        })
        return {
          session,
          visibleSegments,
        }
      })
      .filter(({ session, visibleSegments }) => {
        if (taskReviewProviderFilter.value !== 'all' && session.provider !== taskReviewProviderFilter.value) return false
        if (!visibleSegments.length) return false
        if (!keyword) return true
        const corpus = [
          session.title,
          session.provider,
          session.project,
          ...session.tags,
          ...visibleSegments.flatMap((item) => [item.title, item.firstUserIntent, item.latestAssistantReply]),
        ].join('\n').toLowerCase()
        return corpus.includes(keyword)
      })
      .map(({ session, visibleSegments }) => buildVisibleTaskReviewSessionGroup(session, visibleSegments))
  })

  const taskReviewProviderOptions = computed(() => {
    const values = Array.from(new Set(taskReviewSessions.value.map((item) => item.provider).filter(Boolean))).sort()
    return values.map((value) => ({ value, label: value }))
  })

  const taskReviewTypeOptions = [
    { value: 'all', label: '全部类型' },
    { value: 'bug-investigation', label: 'Bug' },
    { value: 'coding-task', label: '编码任务' },
    { value: 'architecture-discussion', label: '架构讨论' },
    { value: 'prompt-design', label: '提示词' },
    { value: 'general-knowledge', label: '通用知识' },
    { value: 'context-fragment', label: '上下文碎片' },
    { value: 'chitchat', label: '闲聊噪声' },
  ] as const

  const taskReviewStatusOptions = [
    { value: 'all', label: '全部状态' },
    { value: 'pending', label: '待处理' },
    { value: 'kept', label: '已保留' },
    { value: 'downgraded', label: '已降级' },
    { value: 'hidden', label: '已隐藏' },
  ] as const

  const taskReviewActionFilterOptions = [
    { value: 'all', label: '全部动作' },
    { value: 'promote-candidate', label: '标记升格' },
    { value: 'keep-search', label: '保留主检索' },
    { value: 'archive-only', label: '仅归档' },
    { value: 'ignore-noise', label: '忽略噪声' },
    { value: 'needs-context', label: '等待补上下文' },
  ] as const

  const taskReviewAnswerFilterOptions = [
    { value: 'all', label: '全部回答' },
    { value: 'essence', label: '只看回答精华' },
    { value: 'non-essence', label: '非回答精华' },
  ] as const

  const taskReviewPromotionTargetOptions = [
    { value: 'all', label: '全部去向' },
    { value: 'issue-review', label: 'Issue Review' },
    { value: 'pattern-candidate', label: 'Pattern Candidate' },
    { value: 'synthesis-candidate', label: 'Synthesis Candidate' },
  ] as const

  const selectedTaskReviewSession = computed(() =>
    filteredTaskReviewSessions.value.find((item) => item.id === selectedTaskReviewSessionId.value)
    || filteredTaskReviewSessions.value[0]
    || null,
  )

  const selectedTaskReviewItem = computed(() =>
    selectedTaskReviewSession.value?.segments.find((item) => item.id === selectedTaskReviewSegmentId.value)
    || selectedTaskReviewSession.value?.segments[0]
    || null,
  )

  const taskReviewSummaryCards = computed(() => {
    const sessions = taskReviewSessions.value
    const totalSegments = sessions.reduce((sum, item) => sum + item.segmentCount, 0)
    const answerEssenceCount = sessions.reduce(
      (sum, item) => sum + item.segments.filter((segment) => segment.isAnswerEssence).length,
      0,
    )
    const promoteCandidateCount = sessions.reduce(
      (sum, item) => sum + item.segments.filter((segment) => segment.recommendedAction === 'promote-candidate').length,
      0,
    )
    return [
      {
        id: 'total',
        title: '待筛会话',
        count: sessions.length,
        description: `${totalSegments} 个任务段待辅助判断`,
      },
      {
        id: 'retrieval',
        title: '高检索价值',
        count: sessions.filter((item) => item.primaryRetrievalValue >= 70).length,
        description: '主任务段值得优先保留到主检索层',
      },
      {
        id: 'promotion',
        title: '建议送审',
        count: promoteCandidateCount,
        description: '任务段已经接近 issue / pattern / synthesis 原料',
      },
      {
        id: 'answer',
        title: '回答精华',
        count: answerEssenceCount,
        description: '优先回看可沉淀为问答结论的回答段',
      },
      {
        id: 'noise',
        title: '高噪声风险',
        count: sessions.filter((item) => item.primaryNoiseRisk >= 70).length,
        description: '主任务段更适合降级、归档或等待补上下文',
      },
    ]
  })

  const promotionSummaryCards = computed(() => {
    const summary = promotionQueue.value?.summary
    return [
      {
        id: 'total',
        title: '候选总数',
        count: Number(summary?.totalItems || 0),
        description: '这些内容已经值得进人工审核队列',
      },
      {
        id: 'issue',
        title: 'Issue Review',
        count: Number(summary?.issueReviewCount || 0),
        description: '证据还薄，需要人兜底确认',
      },
      {
        id: 'pattern',
        title: 'Pattern Candidate',
        count: Number(summary?.patternCandidateCount || 0),
        description: '开始出现复用形状，但还没正式升格',
      },
      {
        id: 'synthesis',
        title: 'Synthesis Candidate',
        count: Number(summary?.synthesisCandidateCount || 0),
        description: '更像问答结论页的候选',
      },
    ]
  })

  const healthSummaryCards = computed(() => {
    const summary = wikiHealth.value?.summary
    return [
      {
        id: 'findings',
        title: '总发现数',
        count: Number(summary?.totalFindings || 0),
        description: '当前 wiki 的结构健康问题总量',
      },
      {
        id: 'high',
        title: 'High',
        count: Number(summary?.highCount || 0),
        description: '优先处理 broken links 等高风险问题',
      },
      {
        id: 'medium',
        title: 'Medium',
        count: Number(summary?.mediumCount || 0),
        description: '结构和内容稳定性问题',
      },
      {
        id: 'low',
        title: 'Low',
        count: Number(summary?.lowCount || 0),
        description: '长期维护质量和积压提醒',
      },
    ]
  })

  function getHealthFindingKey(item: Partial<HealthFinding> | null | undefined) {
    return [item?.relativePath || '', item?.code || '', item?.title || '', item?.detail || '']
      .map((value) => String(value || '').trim())
      .join('::')
  }

  const healthCodeOptions = computed(() => {
    const counts = new Map<string, number>()
    for (const item of Array.isArray(wikiHealth.value?.findings) ? wikiHealth.value?.findings : []) {
      const code = String(item?.code || '').trim()
      if (!code) continue
      counts.set(code, Number(counts.get(code) || 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => {
        const countDelta = b[1] - a[1]
        if (countDelta) return countDelta
        return a[0].localeCompare(b[0])
      })
      .map(([value, count]) => ({ value, count }))
  })

  const filteredHealthFindings = computed(() => {
    const keyword = normalizeKeyword(healthKeyword.value)
    const findings = Array.isArray(wikiHealth.value?.findings) ? wikiHealth.value?.findings : []
    return findings.filter((item) => {
      if (healthSeverityFilter.value !== 'all' && item.severity !== healthSeverityFilter.value) return false
      if (healthCodeFilter.value !== 'all' && item.code !== healthCodeFilter.value) return false
      if (!keyword) return true
      return [
        item.code,
        item.title,
        item.detail,
        item.suggestion,
        item.relativePath,
      ]
        .map((part) => normalizeKeyword(part))
        .some((part) => part.includes(keyword))
    })
  })

  const healthFindingGroups = computed(() => {
    const grouped = new Map<string, { code: string; severity: HealthFinding['severity']; items: HealthFinding[] }>()
    for (const item of filteredHealthFindings.value) {
      if (!grouped.has(item.code)) {
        grouped.set(item.code, {
          code: item.code,
          severity: item.severity,
          items: [],
        })
      }
      const group = grouped.get(item.code)
      if (!group) continue
      group.items.push(item)
      if (severityRank(item.severity) > severityRank(group.severity)) {
        group.severity = item.severity
      }
    }
    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        items: group.items.slice().sort((a, b) => {
          const severityDelta = severityRank(b.severity) - severityRank(a.severity)
          if (severityDelta) return severityDelta
          return `${a.relativePath} ${a.title}`.localeCompare(`${b.relativePath} ${b.title}`)
        }),
      }))
      .sort((a, b) => {
        const severityDelta = severityRank(b.severity) - severityRank(a.severity)
        if (severityDelta) return severityDelta
        const countDelta = b.items.length - a.items.length
        if (countDelta) return countDelta
        return a.code.localeCompare(b.code)
      })
  })

  const selectedHealthFinding = computed(() =>
    filteredHealthFindings.value.find((item) => getHealthFindingKey(item) === selectedHealthFindingKey.value)
    || filteredHealthFindings.value[0]
    || null,
  )

  const healthSuggestionState = computed(() => ({
    loading: healthSuggestionLoading.value,
    error: healthSuggestionError.value,
    mode: healthSuggestionMode.value,
    findingKey: healthSuggestionKey.value,
    title: healthSuggestionTitle.value,
    description: healthSuggestionDescription.value,
    query: healthSuggestionQuery.value,
    results: healthSuggestionResults.value,
    isCurrentFinding: Boolean(selectedHealthFinding.value) && healthSuggestionKey.value === getHealthFindingKey(selectedHealthFinding.value),
  }))

  const healthActionQueues = computed<HealthActionQueueItem[]>(() => {
    const queues: HealthActionQueueItem[] = []
    for (const definition of HEALTH_ACTION_QUEUE_DEFS) {
      const items = filteredHealthFindings.value.filter((item) => definition.codes.includes(item.code))
      if (!items.length) continue
      const severity = items.reduce<HealthFinding['severity']>((current, item) =>
        severityRank(item.severity) > severityRank(current) ? item.severity : current,
      'low')
      queues.push({
        id: definition.id,
        title: definition.title,
        description: definition.description,
        codes: definition.codes.slice(),
        target: definition.target,
        targetSection: definition.targetSection,
        items,
        count: items.length,
        severity,
      })
    }
    return queues.sort((a, b) => {
      const severityDelta = severityRank(b.severity) - severityRank(a.severity)
      if (severityDelta) return severityDelta
      const countDelta = b.count - a.count
      if (countDelta) return countDelta
      return a.title.localeCompare(b.title)
    })
  })

  const workbenchHero = computed(() => {
    if (workbenchTab.value === 'task-review') {
      return {
        eyebrow: 'Task Review Layer',
        title: '先把会话粗编译成任务单元，再决定哪些值得进入主检索',
        description: '这一步先用 session 级伪 task unit 跑一版筛选，把口语化、跳话题和上下文依赖重的内容先降噪。',
        cards: taskReviewSummaryCards.value,
      }
    }
    if (workbenchTab.value === 'promotion') {
      return {
        eyebrow: 'Promotion Review Layer',
        title: '把接近稳定的候选单独拉出来，避免直接把正式 wiki 写乱',
        description: '这一层是人机协作的升格入口，先看候选为什么值得升格，再决定后续 promote / merge / archive。',
        cards: promotionSummaryCards.value,
      }
    }
    if (workbenchTab.value === 'health') {
      return {
        eyebrow: 'Knowledge Health Layer',
        title: '持续修库，而不是只会生成知识页',
        description: 'Health 负责看 broken links、知识层空洞、长期未处理 draft 等问题，让 wiki 保持可读和可维护。',
        cards: healthSummaryCards.value,
      }
    }
    return {
      eyebrow: 'Data Source Layering',
      title: '先接住原始材料，再决定怎么编译成 wiki',
      description: '这一层不是给模型直接回答问题用的，而是把零散片段、主观笔记和完整文档先分层保存，后面才能持续修订成更稳定的知识页。',
      cards: rawSummaryCards.value,
    }
  })

  const editorPreview = computed(() => extractContentPreview(editorContent.value))
  const quickCapturePreview = computed(() => extractContentPreview(quickCaptureContent.value))
  const quickCaptureBatchEntries = computed(() => parseQuickCaptureBatchEntries(quickCaptureContent.value))
  const quickCaptureCanSave = computed(() =>
    quickCaptureMode.value === 'batch'
      ? quickCaptureBatchEntries.value.length > 0
      : Boolean(String(quickCaptureTitle.value || '').trim() || String(quickCaptureContent.value || '').trim()),
  )
  const quickCaptureSummary = computed(() => {
    if (quickCaptureMode.value === 'batch') {
      const count = quickCaptureBatchEntries.value.length
      return count ? `将拆成 ${count} 条采集项` : '用空行分隔多条片段'
    }
    return quickCapturePreview.value
  })
  const editorDuplicateCandidates = computed(() => {
    const currentId = String(editorId.value || selectedKnowledgeItemId.value || '').trim()
    const sourceUrl = String(editorSourceUrl.value || '').trim().toLowerCase()
    const titleFingerprint = buildKnowledgeFingerprint(editorTitle.value)
    const contentFingerprint = buildKnowledgeFingerprint(editorContent.value)
    if (!sourceUrl && !titleFingerprint && !contentFingerprint) return []

    return knowledgeItems.value
      .filter((item) => item.id !== currentId)
      .map((item) => {
        const itemUrl = String(item.sourceUrl || '').trim().toLowerCase()
        const itemTitleFingerprint = buildKnowledgeFingerprint(item.title)
        const itemContentFingerprint = buildKnowledgeFingerprint(item.content)
        let score = 0
        const reasons: string[] = []
        if (sourceUrl && itemUrl && sourceUrl === itemUrl) {
          score += 90
          reasons.push('来源链接一致')
        }
        if (titleFingerprint && itemTitleFingerprint && titleFingerprint === itemTitleFingerprint) {
          score += 55
          reasons.push('标题一致')
        }
        if (contentFingerprint && itemContentFingerprint) {
          if (contentFingerprint === itemContentFingerprint) {
            score += 80
            reasons.push('内容一致')
          } else if (
            contentFingerprint.length >= 48
            && itemContentFingerprint.length >= 48
            && (contentFingerprint.includes(itemContentFingerprint.slice(0, 80)) || itemContentFingerprint.includes(contentFingerprint.slice(0, 80)))
          ) {
            score += 42
            reasons.push('内容开头相近')
          }
        }
        return {
          item,
          score,
          reason: reasons.join('、'),
        }
      })
      .filter((candidate) => candidate.score >= 42)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
  })

  function resetEditor(sourceType: KnowledgeSourceType = 'capture') {
    editorId.value = ''
    editorSourceType.value = sourceType
    editorSourceSubtype.value = inferDefaultSubtype(sourceType)
    editorStatus.value = 'draft'
    editorTitle.value = ''
    editorContent.value = ''
    editorSourceUrl.value = ''
    editorSourceFile.value = ''
    editorTagsInput.value = ''
    editorProject.value = ''
    editorTopic.value = ''
    editorIntakeStage.value = 'inbox'
    editorConfidence.value = 'medium'
    editorKeyQuestion.value = ''
    editorDecisionNote.value = ''
    selectedKnowledgeItemId.value = ''
  }

  function resetQuickCapture() {
    quickCaptureMode.value = 'single'
    quickCaptureSourceType.value = 'capture'
    quickCaptureTitle.value = ''
    quickCaptureContent.value = ''
    quickCaptureSourceUrl.value = ''
    quickCaptureTagsInput.value = ''
    quickCaptureMarkActive.value = false
    quickCaptureProject.value = ''
    quickCaptureTopic.value = ''
    quickCaptureIntakeStage.value = 'inbox'
    quickCaptureConfidence.value = 'medium'
    quickCaptureDecisionNote.value = ''
  }

  function openQuickCapture(sourceType: KnowledgeSourceType = 'capture') {
    quickCaptureSourceType.value = sourceType
    quickCaptureOpen.value = true
  }

  function closeQuickCapture(force = false) {
    if (quickCaptureSaving.value && !force) return
    quickCaptureOpen.value = false
    resetQuickCapture()
  }

  function applyItemToEditor(item: KnowledgeItemDto | null) {
    if (!item) {
      resetEditor('capture')
      return
    }
    selectedKnowledgeItemId.value = item.id
    editorId.value = item.id
    editorSourceType.value = item.sourceType
    editorSourceSubtype.value = String(item.sourceSubtype || inferDefaultSubtype(item.sourceType))
    editorStatus.value = item.status
    editorTitle.value = item.title
    editorContent.value = item.content
    editorSourceUrl.value = String(item.sourceUrl || '')
    editorSourceFile.value = String(item.sourceFile || '')
    editorTagsInput.value = toTagsInput(item.tags || [])
    editorProject.value = getKnowledgeMetaString(item, 'project')
    editorTopic.value = getKnowledgeMetaString(item, 'topic')
    editorIntakeStage.value = normalizeIntakeStage(item.meta?.intakeStage)
    editorConfidence.value = normalizeConfidence(item.meta?.confidence)
    editorKeyQuestion.value = getKnowledgeMetaString(item, 'keyQuestion')
    editorDecisionNote.value = getKnowledgeMetaString(item, 'decisionNote')
  }

  async function loadKnowledgeItems() {
    knowledgeLoading.value = true
    try {
      const result = await options.service.fetchItems({
        limit: 300,
        q: knowledgeKeyword.value,
        sourceType: knowledgeSourceTypeFilter.value,
        status: knowledgeStatusFilter.value,
      })
      knowledgeItems.value = Array.isArray(result?.items) ? result.items : []
      knowledgeStats.value = result?.stats || { ...EMPTY_STATS, byType: { ...EMPTY_STATS.byType } }

      if (editorId.value) {
        const matched = knowledgeItems.value.find((item) => item.id === editorId.value) || null
        if (matched) {
          applyItemToEditor(matched)
          return
        }
      }

      if (selectedKnowledgeItemId.value) {
        const selected = knowledgeItems.value.find((item) => item.id === selectedKnowledgeItemId.value) || null
        if (selected) {
          applyItemToEditor(selected)
          return
        }
      }

      if (!editorTitle.value && !editorContent.value && knowledgeItems.value[0]) {
        applyItemToEditor(knowledgeItems.value[0])
      }
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '加载失败'), 'danger')
    } finally {
      knowledgeLoading.value = false
    }
  }

  async function loadTaskReviewSessions(force = false) {
    if (taskReviewLoading.value) return
    if (!force && taskReviewSessionsRaw.value.length) return
    taskReviewLoading.value = true
    try {
      const data = await options.sessionService.fetchSessions({
        provider: '',
        q: '',
        from: '',
        to: '',
        conversationId: '',
      })
      taskReviewSessionsRaw.value = Array.isArray(data?.sessions) ? data.sessions.slice(0, 320) : []
      if (!selectedTaskReviewSessionId.value && taskReviewSessionsRaw.value[0]?.id) {
        selectedTaskReviewSessionId.value = taskReviewSessionsRaw.value[0].id
      }
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '加载 Task Review 失败'), 'danger')
    } finally {
      taskReviewLoading.value = false
    }
  }

  async function loadPromotionQueue(force = false) {
    if (promotionQueueLoading.value) return
    if (!force && promotionQueue.value) return
    promotionQueueLoading.value = true
    try {
      promotionQueue.value = await options.wikiService.fetchPromotionQueue(true)
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '加载 Promotion Queue 失败'), 'danger')
    } finally {
      promotionQueueLoading.value = false
    }
  }

  async function loadWikiHealth(force = false) {
    if (healthLoading.value) return
    if (!force && wikiHealth.value) return
    healthLoading.value = true
    try {
      wikiHealth.value = await options.wikiService.fetchLint(true)
      const nextFinding = filteredHealthFindings.value[0]
      selectedHealthFindingKey.value = getHealthFindingKey(nextFinding)
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '加载 Health 失败'), 'danger')
    } finally {
      healthLoading.value = false
    }
  }

  function getPromotionItemKey(item: PromotionQueueItem) {
    return [item.kind, item.currentPath || item.targetPath || '', item.title || '']
      .map((value) => String(value || '').trim())
      .join('::')
  }

  async function setWorkbenchTab(nextTab: KnowledgeWorkbenchTab) {
    workbenchTab.value = nextTab
    if (nextTab === 'task-review') await loadTaskReviewSessions(false)
    if (nextTab === 'promotion') await loadPromotionQueue(false)
    if (nextTab === 'health') await loadWikiHealth(false)
  }

  function selectKnowledgeItem(item: KnowledgeItemDto) {
    applyItemToEditor(item)
  }

  function selectTaskReviewSession(id: string) {
    selectedTaskReviewSessionId.value = String(id || '').trim()
    const session = filteredTaskReviewSessions.value.find((item) => item.id === selectedTaskReviewSessionId.value)
    selectedTaskReviewSegmentId.value = session?.segments[0]?.id || ''
  }

  function selectTaskReviewSegment(id: string) {
    selectedTaskReviewSegmentId.value = String(id || '').trim()
  }

  function selectHealthFinding(item: HealthFinding | null | undefined) {
    selectedHealthFindingKey.value = getHealthFindingKey(item)
    healthSuggestionError.value = ''
    if (healthSuggestionKey.value !== selectedHealthFindingKey.value) {
      healthSuggestionMode.value = ''
      healthSuggestionTitle.value = ''
      healthSuggestionDescription.value = ''
      healthSuggestionQuery.value = ''
      healthSuggestionResults.value = []
    }
  }

  function startNewKnowledgeItem(sourceType: KnowledgeSourceType = 'capture') {
    resetEditor(sourceType)
  }

  async function saveKnowledgeItem() {
    if (knowledgeSaving.value) return false
    knowledgeSaving.value = true
    try {
      const payload = {
        id: editorId.value || undefined,
        sourceType: editorSourceType.value,
        sourceSubtype: editorSourceSubtype.value,
        status: editorStatus.value,
        title: editorTitle.value,
        content: editorContent.value,
        sourceUrl: editorSourceUrl.value,
        sourceFile: editorSourceFile.value,
        tags: parseTagsInput(editorTagsInput.value),
        meta: buildKnowledgeItemMeta(selectedKnowledgeItem.value?.meta, {
          project: editorProject.value.trim(),
          topic: editorTopic.value.trim(),
          intakeStage: editorIntakeStage.value,
          confidence: editorConfidence.value,
          keyQuestion: editorKeyQuestion.value.trim(),
          decisionNote: editorDecisionNote.value.trim(),
        }),
      }
      const result = await options.service.saveItem(payload)
      const item = result?.item || null
      if (item) {
        applyItemToEditor(item)
      }
      options.notify(item?.id ? '知识条目已保存' : '知识条目已创建', 'success')
      await loadKnowledgeItems()
      return true
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '保存失败'), 'danger')
      return false
    } finally {
      knowledgeSaving.value = false
    }
  }

  async function updateKnowledgeItemStatus(status: KnowledgeStatus) {
    const targetId = editorId.value || selectedKnowledgeItemId.value
    if (!targetId || knowledgeSaving.value) return
    knowledgeSaving.value = true
    try {
      const result = await options.service.updateStatus({ id: targetId, status })
      if (result?.item) {
        applyItemToEditor(result.item)
      }
      options.notify(
        status === 'archived' ? '条目已归档' : status === 'active' ? '条目已激活' : '条目已改回草稿',
        'success',
      )
      await loadKnowledgeItems()
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '状态更新失败'), 'danger')
    } finally {
      knowledgeSaving.value = false
    }
  }

  async function deleteKnowledgeItem() {
    const targetId = editorId.value || selectedKnowledgeItemId.value
    if (!targetId || knowledgeSaving.value) return false
    knowledgeSaving.value = true
    try {
      await options.service.deleteItem(targetId)
      options.notify('条目已删除', 'success')
      resetEditor(editorSourceType.value)
      await loadKnowledgeItems()
      return true
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '删除失败'), 'danger')
      return false
    } finally {
      knowledgeSaving.value = false
    }
  }

  async function saveQuickCapture() {
    if (quickCaptureSaving.value || !quickCaptureCanSave.value) return
    quickCaptureSaving.value = true
    try {
      const tags = parseTagsInput(quickCaptureTagsInput.value)
      const sharedMeta = buildKnowledgeItemMeta({}, {
        project: quickCaptureProject.value.trim(),
        topic: quickCaptureTopic.value.trim(),
        intakeStage: quickCaptureIntakeStage.value,
        confidence: quickCaptureConfidence.value,
        keyQuestion: '',
        decisionNote: quickCaptureDecisionNote.value.trim(),
      })
      const entries = quickCaptureMode.value === 'batch'
        ? quickCaptureBatchEntries.value
        : [{
            id: 'single',
            title: String(quickCaptureTitle.value || '').trim(),
            content: String(quickCaptureContent.value || '').trim(),
          }]
      let lastItem: KnowledgeItemDto | null = null
      for (const [index, entry] of entries.entries()) {
        const entryTitle = String(quickCaptureTitle.value || '').trim()
          ? entries.length > 1
            ? `${quickCaptureTitle.value.trim()} ${index + 1}`
            : quickCaptureTitle.value.trim()
          : entry.title
        const result = await options.service.saveItem({
          sourceType: quickCaptureSourceType.value,
          sourceSubtype: inferDefaultSubtype(quickCaptureSourceType.value),
          status: quickCaptureMarkActive.value ? 'active' : 'draft',
          title: entryTitle,
          content: entry.content,
          sourceUrl: quickCaptureSourceUrl.value,
          tags,
          meta: sharedMeta,
        })
        const item = result?.item || null
        if (item) {
          lastItem = item
          options.onQuickCaptureSaved?.(item)
        }
      }
      if (lastItem) {
        applyItemToEditor(lastItem)
      }
      closeQuickCapture(true)
      await loadKnowledgeItems()
      options.notify(entries.length > 1 ? `已批量保存 ${entries.length} 条采集项` : '快速采集已保存', 'success')
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '快速采集失败'), 'danger')
    } finally {
      quickCaptureSaving.value = false
    }
  }

  async function applyTaskReviewAction(action: TaskReviewAction, segmentId = '', sessionId = '') {
    const targetSegmentId = String(segmentId || selectedTaskReviewItem.value?.id || '').trim()
    const targetSessionId = String(sessionId || selectedTaskReviewItem.value?.sessionId || '').trim()
    if (!targetSegmentId || !targetSessionId || taskReviewUpdatingId.value) return false
    taskReviewUpdatingId.value = targetSegmentId
    try {
      const payloadByAction: Record<TaskReviewAction, Parameters<typeof options.sessionService.updateSessionReview>[0]> = {
        'keep-search': {
          id: targetSessionId,
          segmentId: targetSegmentId,
          status: 'kept',
          keepInSearch: true,
          qualityScore: 80,
          note: 'knowledge-workbench: keep-search',
          reviewedBy: 'knowledge-workbench',
        },
        'promote-candidate': {
          id: targetSessionId,
          segmentId: targetSegmentId,
          status: 'kept',
          keepInSearch: true,
          qualityScore: 90,
          note: 'knowledge-workbench: promote-candidate',
          reviewedBy: 'knowledge-workbench',
        },
        'archive-only': {
          id: targetSessionId,
          segmentId: targetSegmentId,
          status: 'downgraded',
          keepInSearch: false,
          qualityScore: 36,
          note: 'knowledge-workbench: archive-only',
          reviewedBy: 'knowledge-workbench',
        },
        'ignore-noise': {
          id: targetSessionId,
          segmentId: targetSegmentId,
          status: 'hidden',
          keepInSearch: false,
          qualityScore: 0,
          note: 'knowledge-workbench: ignore-noise',
          reviewedBy: 'knowledge-workbench',
        },
        'needs-context': {
          id: targetSessionId,
          segmentId: targetSegmentId,
          status: 'pending',
          keepInSearch: false,
          qualityScore: null,
          note: 'knowledge-workbench: needs-context',
          reviewedBy: 'knowledge-workbench',
        },
      }
      await options.sessionService.updateSessionReview(payloadByAction[action])
      options.notify('Task Review 已更新', 'success')
      await Promise.all([
        loadTaskReviewSessions(true),
        action === 'promote-candidate' ? loadPromotionQueue(true) : Promise.resolve(),
      ])
      return true
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || 'Task Review 更新失败'), 'danger')
      return false
    } finally {
      taskReviewUpdatingId.value = ''
    }
  }

  async function applyPromotionCandidate(item: PromotionQueueItem) {
    await decidePromotionCandidate(item, 'approve')
  }

  async function decidePromotionCandidate(
    item: PromotionQueueItem,
    decision: 'approve' | 'dismiss' | 'revoke',
  ) {
    const itemKey = getPromotionItemKey(item)
    if (!itemKey || promotionApplyingKey.value) return
    promotionApplyingKey.value = itemKey
    try {
      await options.wikiService.decidePromotion({
        decision,
        kind: item.kind,
        title: item.title,
        currentPath: item.currentPath,
        targetPath: item.targetPath,
        project: item.project,
        summary: item.summary,
        evidenceItems: Array.isArray(item.evidenceItems) ? item.evidenceItems : [],
      })
      await Promise.all([
        loadPromotionQueue(true),
        loadWikiHealth(true),
      ])
      if (decision === 'approve') {
        options.notify('已升格到 reader-first wiki', 'success')
      } else if (decision === 'dismiss') {
        options.notify('已驳回自动候选', 'success')
      } else {
        options.notify('已撤销人工确认，候选会回到自动判断态', 'success')
      }
    } catch (error) {
      const fallbackMessage = decision === 'approve'
        ? '升格失败'
        : decision === 'dismiss'
          ? '驳回失败'
          : '撤销失败'
      options.notify(String(error instanceof Error ? error.message : error || fallbackMessage), 'danger')
    } finally {
      promotionApplyingKey.value = ''
    }
  }

  async function dismissPromotionCandidate(item: PromotionQueueItem) {
    await decidePromotionCandidate(item, 'dismiss')
  }

  async function revokePromotionCandidate(item: PromotionQueueItem) {
    await decidePromotionCandidate(item, 'revoke')
  }

  async function previewPromotionCandidate(item: PromotionQueueItem) {
    if (promotionPreviewLoading.value) return
    promotionPreviewOpen.value = true
    promotionPreviewLoading.value = true
    promotionPreviewError.value = ''
    promotionPreviewData.value = null
    try {
      promotionPreviewData.value = await options.wikiService.previewPromotion({
        kind: item.kind,
        title: item.title,
        currentPath: item.currentPath,
        targetPath: item.targetPath,
        project: item.project,
        summary: item.summary,
        evidenceItems: Array.isArray(item.evidenceItems) ? item.evidenceItems : [],
      })
    } catch (error) {
      promotionPreviewError.value = String(error instanceof Error ? error.message : error || '预览失败')
    } finally {
      promotionPreviewLoading.value = false
    }
  }

  async function openPromotionNoteViewer(paths: string[] | string, title = '内容详情') {
    const relativePaths = (Array.isArray(paths) ? paths : [paths])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    if (!relativePaths.length || promotionViewerLoading.value) return
    promotionViewerOpen.value = true
    promotionViewerLoading.value = true
    promotionViewerError.value = ''
    promotionViewerTitle.value = title
    promotionViewerPaths.value = relativePaths
    try {
      const settled = await Promise.allSettled(relativePaths.map((relativePath) => options.wikiService.fetchNote(relativePath)))
      promotionViewerNotes.value = settled
        .filter((item): item is PromiseFulfilledResult<{ ok: boolean; note: PromotionEvidenceNote }> => item.status === 'fulfilled')
        .map((item) => item.value?.note || null)
        .filter(Boolean)
      if (!promotionViewerNotes.value.length) {
        promotionViewerError.value = '未读取到详情内容'
      }
    } catch (error) {
      promotionViewerNotes.value = []
      promotionViewerError.value = String(error instanceof Error ? error.message : error || '读取详情失败')
    } finally {
      promotionViewerLoading.value = false
    }
  }

  async function openPromotionEvidence(paths: string[] | string) {
    await openPromotionNoteViewer(paths, '证据详情')
  }

  async function runHealthSuggestionSearch({
    item,
    mode,
    title,
    description,
    query,
    spaces = [],
    hintBuilder,
  }: {
    item: HealthFinding | null | undefined
    mode: HealthSuggestionMode
    title: string
    description: string
    query: string
    spaces?: string[]
    hintBuilder: (result: WikiSearchResult, index: number) => string
  }) {
    const findingKey = getHealthFindingKey(item)
    const normalizedQuery = dedupeStrings(tokenizeForSearch(query), 6).join(' ').trim() || String(query || '').trim()
    if (!findingKey || !normalizedQuery || healthSuggestionLoading.value) return
    healthSuggestionLoading.value = true
    healthSuggestionError.value = ''
    healthSuggestionMode.value = mode
    healthSuggestionKey.value = findingKey
    healthSuggestionTitle.value = title
    healthSuggestionDescription.value = description
    healthSuggestionQuery.value = normalizedQuery
    try {
      const response = await options.wikiService.search({
        query: normalizedQuery,
        topK: 6,
        spaces: Array.isArray(spaces) ? spaces : [],
      })
      healthSuggestionResults.value = (Array.isArray(response?.results) ? response.results : [])
        .filter((result) => String(result?.path || '').trim() !== String(item?.relativePath || '').trim())
        .map((result, index) => ({
          ...result,
          hint: hintBuilder(result, index),
        }))
        .slice(0, 6)
      if (!healthSuggestionResults.value.length) {
        healthSuggestionError.value = '没有找到足够接近的候选页面。'
      }
    } catch (error) {
      healthSuggestionResults.value = []
      healthSuggestionError.value = String(error instanceof Error ? error.message : error || '生成建议失败')
    } finally {
      healthSuggestionLoading.value = false
    }
  }

  async function loadHealthRepairSuggestions(item: HealthFinding | null | undefined) {
    const brokenTarget = extractBrokenTarget(item?.detail)
    const targetLabel = basenameWithoutMarkdown(brokenTarget)
    const query = dedupeStrings([
      targetLabel,
      ...tokenizeForSearch(targetLabel),
      ...tokenizeForSearch(brokenTarget),
    ], 6).join(' ')
    await runHealthSuggestionSearch({
      item,
      mode: 'repair',
      title: '断链修复建议',
      description: brokenTarget
        ? `根据缺失目标 “${brokenTarget}” 搜索最接近的现有页面，先确认最可能的替换路径。`
        : '根据当前 finding 的缺失目标搜索最接近的现有页面。',
      query,
      hintBuilder(result, index) {
        const resultBase = basenameWithoutMarkdown(result.path)
        if (targetLabel && resultBase === targetLabel) return '路径名完全接近，可优先检查'
        if (targetLabel && String(result.title || '').toLowerCase().includes(targetLabel.toLowerCase())) return '标题接近缺失目标'
        if (index === 0) return '搜索分最高，适合作为第一候选'
        return '可作为替换目标的备选页'
      },
    })
  }

  async function loadHealthAnchorSuggestions(item: HealthFinding | null | undefined) {
    const relativePath = String(item?.relativePath || '').trim()
    if (!relativePath || healthSuggestionLoading.value) return
    try {
      const response = await options.wikiService.fetchNote(relativePath)
      const note = response?.note
      const query = dedupeStrings([
        note?.project,
        note?.title,
        ...tokenizeForSearch(note?.title),
      ], 6).join(' ')
      const spaces = item?.code === 'concept-unanchored'
        ? ['projects', 'patterns', 'issues', 'syntheses']
        : ['projects', 'patterns', 'issues', 'syntheses', 'concepts']
      await runHealthSuggestionSearch({
        item,
        mode: 'anchor',
        title: item?.code === 'concept-unanchored' ? '概念锚点建议' : '回链锚点建议',
        description: note?.project
          ? `优先找和项目 “${note.project}” 同域的 reader-first 页面，把它补进主阅读层。`
          : '优先找和当前页面标题最接近的 reader-first 页面，作为回链入口。',
        query,
        spaces,
        hintBuilder(result, index) {
          if (note?.project && result.project === note.project) return '同项目页面，适合作为首个锚点'
          if (index === 0) return '搜索分最高，适合先检查是否应该互链'
          return '可作为补链或 Related 段的候选页'
        },
      })
    } catch (error) {
      healthSuggestionMode.value = 'anchor'
      healthSuggestionKey.value = getHealthFindingKey(item)
      healthSuggestionTitle.value = item?.code === 'concept-unanchored' ? '概念锚点建议' : '回链锚点建议'
      healthSuggestionDescription.value = ''
      healthSuggestionQuery.value = ''
      healthSuggestionResults.value = []
      healthSuggestionError.value = String(error instanceof Error ? error.message : error || '读取当前页面失败')
    }
  }

  function collectHealthFindingPaths(items: Array<HealthFinding | null | undefined>, limit = 8) {
    const deduped = new Set<string>()
    for (const item of Array.isArray(items) ? items : []) {
      const relativePath = String(item?.relativePath || '').trim()
      if (!relativePath) continue
      deduped.add(relativePath)
      if (deduped.size >= limit) break
    }
    return Array.from(deduped)
  }

  async function openHealthFindingNotes(items: Array<HealthFinding | null | undefined>, title = '巡检关联页面') {
    const relativePaths = collectHealthFindingPaths(items)
    if (!relativePaths.length) {
      options.notify('当前没有可打开的关联页面', 'warning')
      return
    }
    await openPromotionNoteViewer(relativePaths, title)
  }

  async function resolveHealthEvidencePaths(items: Array<HealthFinding | null | undefined>, limit = 12) {
    const relativePaths = collectHealthFindingPaths(items, 10)
    if (!relativePaths.length) return []
    const settled = await Promise.allSettled(relativePaths.map((relativePath) => options.wikiService.fetchNote(relativePath)))
    const evidenceTargets = new Set<string>()
    const sourceTargets = new Set<string>()
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue
      const evidenceBody = extractMarkdownSectionText(result.value?.note?.markdown || result.value?.note?.body || '', 'Evidence')
      for (const target of parseWikiLinkTargets(evidenceBody)) {
        if (target.startsWith('sources/')) sourceTargets.add(target)
        else evidenceTargets.add(target)
        if (sourceTargets.size >= limit || evidenceTargets.size >= limit) break
      }
    }
    const primary = sourceTargets.size ? Array.from(sourceTargets) : Array.from(evidenceTargets)
    return primary.slice(0, limit)
  }

  async function openHealthFindingNote(item: HealthFinding | null | undefined) {
    await openHealthFindingNotes([item], `巡检关联页面 · ${item?.title || item?.relativePath || '当前问题'}`)
  }

  async function openHealthFindingEvidence(item: HealthFinding | null | undefined) {
    const relativePath = String(item?.relativePath || '').trim()
    if (!relativePath) return
    try {
      const targetPaths = await resolveHealthEvidencePaths([item])
      if (!targetPaths.length) {
        options.notify('当前页面还没有可展开的 Evidence 链接', 'warning')
        return
      }
      await openPromotionNoteViewer(targetPaths, `Source Evidence · ${item?.title || relativePath}`)
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '读取 Evidence 失败'), 'danger')
    }
  }

  async function openHealthQueueNotes(items: Array<HealthFinding | null | undefined>, title = '批量关联页面') {
    await openHealthFindingNotes(items, title)
  }

  async function openHealthQueueEvidence(items: Array<HealthFinding | null | undefined>, title = '批量 Source Evidence') {
    try {
      const targetPaths = await resolveHealthEvidencePaths(items)
      if (!targetPaths.length) {
        options.notify('当前队列还没有可展开的 Evidence 链接', 'warning')
        return
      }
      await openPromotionNoteViewer(targetPaths, title)
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '读取批量 Evidence 失败'), 'danger')
    }
  }

  async function batchDecideHealthStaleDraftIssues(
    decision: 'approve' | 'dismiss',
    items: Array<HealthFinding | null | undefined> = [],
  ) {
    if (healthBatchActionLoading.value) return
    const targetPaths = new Set(
      (Array.isArray(items) ? items : [])
        .filter((item): item is HealthFinding => !!item && item.code === 'stale-draft-issue')
        .map((item) => String(item.relativePath || '').trim())
        .filter(Boolean),
    )
    if (!targetPaths.size) {
      options.notify('当前没有可批量处理的 stale draft issue', 'warning')
      return
    }
    if (!promotionQueue.value) {
      await loadPromotionQueue(true)
    }
    const candidates = (promotionQueue.value?.issueReviews || [])
      .filter((item) => targetPaths.has(String(item.currentPath || '').trim()))
    if (!candidates.length) {
      options.notify('当前没有匹配到可批量处理的 issue review 候选', 'warning')
      return
    }
    healthBatchActionLoading.value = true
    healthBatchActionLabel.value = decision === 'approve' ? '批量升格 stale draft issues' : '批量驳回 stale draft issues'
    let succeeded = 0
    let failed = 0
    for (const candidate of candidates) {
      try {
        await options.wikiService.decidePromotion({
          decision,
          kind: 'issue-review',
          title: candidate.title,
          currentPath: candidate.currentPath,
          project: candidate.project,
          summary: candidate.summary,
          evidenceItems: Array.isArray(candidate.evidenceItems) ? candidate.evidenceItems : [],
        })
        succeeded += 1
      } catch {
        failed += 1
      }
    }
    await Promise.all([
      loadPromotionQueue(true),
      loadWikiHealth(true),
    ])
    healthBatchActionLoading.value = false
    healthBatchActionLabel.value = ''
    if (failed > 0) {
      options.notify(`批量处理完成：成功 ${succeeded} 条，失败 ${failed} 条`, failed === candidates.length ? 'danger' : 'warning')
      return
    }
    options.notify(
      decision === 'approve'
        ? `已批量升格 ${succeeded} 条 stale draft issue`
        : `已批量驳回 ${succeeded} 条 stale draft issue`,
      'success',
    )
  }

  async function applyHealthRepairSuggestion(
    item: HealthFinding | null | undefined,
    candidatePath: string,
  ) {
    const relativePath = String(item?.relativePath || '').trim()
    const fromTarget = extractBrokenTarget(item?.detail)
    const toTarget = String(candidatePath || '').trim()
    if (!relativePath || !fromTarget || !toTarget || healthRepairApplyingTarget.value) return
    healthRepairApplyingTarget.value = `${relativePath}::${toTarget}`
    try {
      await options.wikiService.repairLink({
        path: relativePath,
        fromTarget,
        toTarget,
      })
      options.notify('断链已替换为建议目标', 'success')
      healthSuggestionMode.value = ''
      healthSuggestionKey.value = ''
      healthSuggestionTitle.value = ''
      healthSuggestionDescription.value = ''
      healthSuggestionQuery.value = ''
      healthSuggestionResults.value = []
      await loadWikiHealth(true)
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || '断链修复失败'), 'danger')
    } finally {
      healthRepairApplyingTarget.value = ''
    }
  }

  function closePromotionViewer() {
    promotionViewerOpen.value = false
    promotionViewerLoading.value = false
    promotionViewerError.value = ''
    promotionViewerTitle.value = ''
    promotionViewerPaths.value = []
    promotionViewerNotes.value = []
  }

  function closePromotionPreview() {
    promotionPreviewOpen.value = false
    promotionPreviewLoading.value = false
    promotionPreviewError.value = ''
    promotionPreviewData.value = null
  }

  return {
    workbenchTab,
    workbenchTabs: TASK_REVIEW_TAB_OPTIONS,
    workbenchHero,
    setWorkbenchTab,
    knowledgeItems,
    knowledgeStats,
    knowledgeLoading,
    knowledgeSaving,
    selectedKnowledgeItemId,
    selectedKnowledgeItem,
    filteredKnowledgeItems,
    knowledgeSourceTypeFilter,
    knowledgeStatusFilter,
    knowledgeIntakeStageFilter,
    knowledgeConfidenceFilter,
    knowledgeKeyword,
    summaryCards: rawSummaryCards,
    sourceTypeOptions,
    statusOptions,
    intakeStageOptions,
    confidenceOptions,
    subtypeSuggestions,
    editorIntakeStageOption,
    editorConfidenceOption,
    editorIntakeSummary,
    editorId,
    editorSourceType,
    editorSourceSubtype,
    editorStatus,
    editorTitle,
    editorContent,
    editorSourceUrl,
    editorSourceFile,
    editorTagsInput,
    editorProject,
    editorTopic,
    editorIntakeStage,
    editorConfidence,
    editorKeyQuestion,
    editorDecisionNote,
    editorPreview,
    editorDuplicateCandidates,
    quickCaptureOpen,
    quickCaptureSaving,
    quickCaptureMode,
    quickCaptureSourceType,
    quickCaptureTitle,
    quickCaptureContent,
    quickCaptureSourceUrl,
    quickCaptureTagsInput,
    quickCaptureMarkActive,
    quickCaptureProject,
    quickCaptureTopic,
    quickCaptureIntakeStage,
    quickCaptureConfidence,
    quickCaptureDecisionNote,
    quickCapturePreview,
    quickCaptureBatchEntries,
    quickCaptureCanSave,
    quickCaptureSummary,
    taskReviewLoading,
    taskReviewUpdatingId,
    taskReviewKeyword,
    taskReviewProviderFilter,
    taskReviewStatusFilter,
    taskReviewTypeFilter,
    taskReviewActionFilter,
    taskReviewAnswerFilter,
    taskReviewPromotionTargetFilter,
    taskReviewProviderOptions,
    taskReviewStatusOptions,
    taskReviewTypeOptions,
    taskReviewActionFilterOptions,
    taskReviewAnswerFilterOptions,
    taskReviewPromotionTargetOptions,
    taskReviewSessions: filteredTaskReviewSessions,
    taskReviewSummaryCards,
    selectedTaskReviewSessionId,
    selectedTaskReviewSegmentId,
    selectedTaskReviewSession,
    selectedTaskReviewItem,
    promotionQueueLoading,
    promotionQueue,
    promotionApplyingKey,
    promotionPreviewOpen,
    promotionPreviewLoading,
    promotionPreviewError,
    promotionPreviewData,
    promotionViewerOpen,
    promotionViewerLoading,
    promotionViewerError,
    promotionViewerTitle,
    promotionViewerPaths,
    promotionViewerNotes,
    promotionSummaryCards,
    healthLoading,
    wikiHealth,
    healthSummaryCards,
    healthSeverityFilter,
    healthCodeFilter,
    healthKeyword,
    healthCodeOptions,
    filteredHealthFindings,
    healthFindingGroups,
    healthActionQueues,
    selectedHealthFinding,
    healthSuggestionState,
    healthBatchActionLoading,
    healthBatchActionLabel,
    healthRepairApplyingTarget,
    loadKnowledgeItems,
    loadTaskReviewSessions,
    loadPromotionQueue,
    loadWikiHealth,
    selectKnowledgeItem,
    selectTaskReviewSession,
    selectTaskReviewSegment,
    selectHealthFinding,
    startNewKnowledgeItem,
    saveKnowledgeItem,
    updateKnowledgeItemStatus,
    deleteKnowledgeItem,
    openQuickCapture,
    closeQuickCapture,
    saveQuickCapture,
    applyTaskReviewAction,
    applyPromotionCandidate,
    dismissPromotionCandidate,
    revokePromotionCandidate,
    previewPromotionCandidate,
    openPromotionEvidence,
    openHealthFindingNote,
    openHealthFindingEvidence,
    openHealthQueueNotes,
    openHealthQueueEvidence,
    loadHealthRepairSuggestions,
    loadHealthAnchorSuggestions,
    batchDecideHealthStaleDraftIssues,
    applyHealthRepairSuggestion,
    closePromotionPreview,
    closePromotionViewer,
    resetEditor,
  }
}
