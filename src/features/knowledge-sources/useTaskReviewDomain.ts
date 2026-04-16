import { computed, ref } from 'vue'
import type { SessionDataApi } from '@/services/kbApiServices'
import type { Issue, SessionItem, SessionRetrieveResponse, SessionReviewStatus } from '@/features/session/types'
import { dedupeStrings } from './knowledgeWorkbenchUtils'

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

export type {
  TaskReviewType,
  TaskReviewAction,
  TaskReviewStatusFilter,
  TaskReviewTypeFilter,
  PromotionTargetKind,
  TaskReviewActionFilter,
  TaskReviewAnswerFilter,
  TaskReviewPromotionTargetFilter,
  TaskReviewItem,
  TaskReviewSessionGroup,
}

interface UseTaskReviewDomainOptions {
  sessionService: SessionDataApi<SessionItem, Issue, SessionRetrieveResponse>
  notify: (message: string, tone?: 'info' | 'success' | 'warning' | 'danger') => void
  loadPromotionQueue: (force?: boolean) => Promise<void>
}

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

function clipText(value: string, limit = 160) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
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

function scoreAnswerEssence(scoreOptions: {
  provider: string
  taskType: TaskReviewType
  firstUserIntent: string
  latestAssistantReply: string
  bestAssistantAnswer: string
  project: string
  codeSignals: number
  messageCount: number
}) {
  const provider = String(scoreOptions.provider || '').trim().toLowerCase()
  const userIntent = String(scoreOptions.firstUserIntent || '').trim()
  const bestAnswer = String(scoreOptions.bestAssistantAnswer || scoreOptions.latestAssistantReply || '').trim()
  let score = 10

  if (ANSWER_QUESTION_PATTERNS.some((pattern) => pattern.test(userIntent))) score += 28
  if (ANSWER_STRUCTURE_PATTERNS.some((pattern) => pattern.test(bestAnswer))) score += 22
  if (bestAnswer.length >= 220) score += 16
  else if (bestAnswer.length >= 120) score += 10
  else if (bestAnswer.length >= 80) score += 6

  if (provider === 'codex' || provider === 'cursor') score += 8
  if (scoreOptions.taskType === 'general-knowledge') score += 10
  if (scoreOptions.taskType === 'architecture-discussion') score += 8
  if (scoreOptions.taskType === 'prompt-design') score += 6
  if (scoreOptions.project) score += 4
  if (scoreOptions.messageCount >= 4) score += 4
  if (scoreOptions.codeSignals >= 4) score -= 6
  else if (scoreOptions.codeSignals >= 2) score -= 3
  if (scoreOptions.taskType === 'bug-investigation') score -= 18
  if (ANSWER_NEGATIVE_PATTERNS.some((pattern) => pattern.test(bestAnswer))) score -= 18

  return clampScore(score)
}

function buildAnswerEssenceReasons(reasonOptions: {
  taskType: TaskReviewType
  firstUserIntent: string
  bestAssistantAnswer: string
  project: string
  answerScore: number
  codeSignals: number
  messageCount: number
}) {
  const reasons: string[] = []
  const intent = String(reasonOptions.firstUserIntent || '')
  const bestAnswer = String(reasonOptions.bestAssistantAnswer || '')

  if (reasonOptions.answerScore >= 64) reasons.push('回答精华分已过阈值')
  else if (reasonOptions.answerScore >= 56) reasons.push('回答有沉淀潜力')
  if (ANSWER_QUESTION_PATTERNS.some((pattern) => pattern.test(intent))) reasons.push('起始问题是明确问答')
  if (ANSWER_STRUCTURE_PATTERNS.some((pattern) => pattern.test(bestAnswer))) reasons.push('回答结构清晰')
  if (bestAnswer.length >= 220) reasons.push('答案信息量较足')
  else if (bestAnswer.length >= 120) reasons.push('答案长度适合复核')
  if (['general-knowledge', 'architecture-discussion', 'prompt-design'].includes(reasonOptions.taskType)) reasons.push('任务类型偏长期知识')
  if (reasonOptions.project) reasons.push('项目归属可定位')
  if (reasonOptions.messageCount >= 4) reasons.push('上下文轮次足够')
  if (reasonOptions.codeSignals >= 4) reasons.push('代码过程信号偏重，升格前需复核')
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

export function useTaskReviewDomain(options: UseTaskReviewDomainOptions) {
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

  function selectTaskReviewSession(id: string) {
    selectedTaskReviewSessionId.value = String(id || '').trim()
    const session = filteredTaskReviewSessions.value.find((item) => item.id === selectedTaskReviewSessionId.value)
    selectedTaskReviewSegmentId.value = session?.segments[0]?.id || ''
  }

  function selectTaskReviewSegment(id: string) {
    selectedTaskReviewSegmentId.value = String(id || '').trim()
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
        action === 'promote-candidate' ? options.loadPromotionQueue(true) : Promise.resolve(),
      ])
      return true
    } catch (error) {
      options.notify(String(error instanceof Error ? error.message : error || 'Task Review 更新失败'), 'danger')
      return false
    } finally {
      taskReviewUpdatingId.value = ''
    }
  }

  return {
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
    loadTaskReviewSessions,
    selectTaskReviewSession,
    selectTaskReviewSegment,
    applyTaskReviewAction,
  }
}
