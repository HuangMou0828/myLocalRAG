import { spawn } from 'node:child_process'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { loadPromptOptimizationByKey, savePromptOptimizationByKey } from './db.mjs'

function normalizeText(input) {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function normalizeList(input) {
  if (Array.isArray(input)) return input.map((item) => normalizeText(item)).filter(Boolean)
  if (typeof input === 'string') return input.split('\n').map((item) => normalizeText(item)).filter(Boolean)
  return []
}

function normalizeLanguage(input) {
  const value = String(input || '').trim().toLowerCase()
  if (!value) return 'zh-CN'
  if (value.startsWith('zh')) return 'zh-CN'
  if (value.startsWith('en')) return 'en-US'
  return value
}

function buildCacheKey(payload) {
  const serialized = JSON.stringify({
    prompt: normalizeText(payload?.prompt || ''),
    taskType: normalizeText(payload?.taskType || ''),
    model: normalizeText(payload?.model || ''),
    apiBase: normalizeText(payload?.apiBase || ''),
    provider: normalizeText(payload?.provider || ''),
    language: normalizeLanguage(payload?.language || ''),
    contextMessages: normalizeList(payload?.contextMessages),
    constraints: normalizeList(payload?.constraints),
  })
  return createHash('sha256').update(serialized).digest('hex')
}

function buildFallbackOptimization(payload, reason = '') {
  const prompt = normalizeText(payload?.prompt || '')
  const taskType = normalizeText(payload?.taskType || 'general')
  const language = normalizeLanguage(payload?.language || '')
  const contextMessages = normalizeList(payload?.contextMessages).slice(-6)
  const constraints = normalizeList(payload?.constraints)

  const contextBlock = contextMessages.length
    ? contextMessages.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
    : '1. 当前会话默认上下文（无额外补充）'

  const constraintsBlock = constraints.length
    ? constraints.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
    : '1. 输出保持简洁且可执行\n2. 不要省略关键步骤'

  const optimizedPrompt = [
    language.startsWith('en')
      ? `You are a ${taskType === 'coding' ? 'senior software engineering assistant' : 'high-quality execution assistant'}.`
      : `你是一名${taskType === 'coding' ? '资深工程开发助手' : '高质量任务执行助手'}。请完成以下任务。`,
    '',
    language.startsWith('en') ? '## Task Goal' : '## 任务目标',
    prompt || (language.startsWith('en') ? 'Please complete the task according to the request.' : '请根据给定需求完成任务。'),
    '',
    language.startsWith('en') ? '## Known Context' : '## 已知上下文',
    contextBlock,
    '',
    language.startsWith('en') ? '## Constraints' : '## 约束条件',
    constraintsBlock,
    '',
    language.startsWith('en') ? '## Output Format' : '## 输出格式',
    language.startsWith('en') ? 'Use this structure:' : '请按以下结构输出：',
    language.startsWith('en') ? '1. Summary (3-5 bullets)' : '1. 结论摘要（3-5条）',
    language.startsWith('en') ? '2. Detailed steps (numbered)' : '2. 详细步骤（编号）',
    language.startsWith('en') ? '3. Self-check list (at least 3 verifiable items)' : '3. 自检清单（至少3条，可验证）',
  ].join('\n')

  return {
    mode: 'fallback',
    optimizedPrompt,
    changes: [
      '补齐了任务目标、上下文、约束、输出格式四段结构。',
      '引入显式自检要求，提升结果可验证性。',
      '保留了原始任务语义，减少改写偏移。',
    ],
    rationale: [
      '结构化 Prompt 可降低模型理解歧义。',
      '显式约束和验收规则通常可提升稳定性。',
      reason || '当前未使用 DSPy 优化器，已使用本地规则改写。',
    ],
    meta: {
      dspyAvailable: false,
      language,
      fallbackReason: reason || 'DSPy 不可用',
    },
  }
}

function resolveTimeoutMs(payload) {
  const fromPayload = Number(payload?.timeoutMs || 0)
  const fromEnv = Number(process.env.DSPY_TIMEOUT_MS || 0)
  const candidate = fromPayload > 0 ? fromPayload : fromEnv > 0 ? fromEnv : 90000
  return Math.max(10000, Math.min(candidate, 300000))
}

function runPythonOptimizer(payload, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve('scripts/prompt_optimize_dspy.py')
    const child = spawn('python3', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('DSPy optimizer timeout'))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(stderr.trim() || `python exit code=${code}`))
        return
      }
      try {
        const parsed = JSON.parse(stdout || '{}')
        resolve(parsed)
      } catch (error) {
        reject(new Error(`invalid optimizer output: ${String(error)}`))
      }
    })

    child.stdin.write(JSON.stringify(payload || {}))
    child.stdin.end()
  })
}

export async function optimizePrompt(payload) {
  const prompt = normalizeText(payload?.prompt || '')
  if (!prompt) {
    throw new Error('prompt 必填')
  }

  const normalizedPayload = {
    prompt,
    promptId: normalizeText(payload?.promptId || ''),
    taskType: normalizeText(payload?.taskType || ''),
    model: normalizeText(payload?.model || ''),
    apiBase: normalizeText(payload?.apiBase || ''),
    apiKey: normalizeText(payload?.apiKey || ''),
    provider: normalizeText(payload?.provider || ''),
    language: normalizeLanguage(payload?.language || ''),
    forceRegenerate: Boolean(payload?.forceRegenerate),
    contextMessages: normalizeList(payload?.contextMessages),
    constraints: normalizeList(payload?.constraints),
  }
  const cacheKey = buildCacheKey(normalizedPayload)

  if (!normalizedPayload.forceRegenerate) {
    const cached = await loadPromptOptimizationByKey(cacheKey)
    if (cached?.optimizedPrompt) {
      return {
        ...cached,
        cached: true,
        cacheKey,
      }
    }
  }

  try {
    const timeoutMs = resolveTimeoutMs(payload)
    const result = await runPythonOptimizer(normalizedPayload, timeoutMs)
    if (result && typeof result === 'object' && result.optimizedPrompt) {
      const saved = await savePromptOptimizationByKey({
        cacheKey,
        promptId: normalizedPayload.promptId,
        language: normalizedPayload.language,
        taskType: normalizedPayload.taskType,
        model: normalizedPayload.model,
        mode: result.mode || 'fallback',
        optimizedPrompt: result.optimizedPrompt,
        changes: result.changes,
        rationale: result.rationale,
        meta: { ...(result.meta || {}), timeoutMs },
      })
      return { ...saved, timeoutMs, cached: false, cacheKey }
    }
    const fallback = buildFallbackOptimization(normalizedPayload, 'DSPy 返回结构不完整，已降级到规则改写。')
    const saved = await savePromptOptimizationByKey({
      cacheKey,
      promptId: normalizedPayload.promptId,
      language: normalizedPayload.language,
      taskType: normalizedPayload.taskType,
      model: normalizedPayload.model,
      mode: fallback.mode,
      optimizedPrompt: fallback.optimizedPrompt,
      changes: fallback.changes,
      rationale: fallback.rationale,
      meta: { ...(fallback.meta || {}), timeoutMs },
    })
    return {
      ...saved,
      timeoutMs,
      cached: false,
      cacheKey,
    }
  } catch (error) {
    const timeoutMs = resolveTimeoutMs(payload)
    const fallback = buildFallbackOptimization(normalizedPayload, `无法调用 DSPy：${String(error)}`)
    const saved = await savePromptOptimizationByKey({
      cacheKey,
      promptId: normalizedPayload.promptId,
      language: normalizedPayload.language,
      taskType: normalizedPayload.taskType,
      model: normalizedPayload.model,
      mode: fallback.mode,
      optimizedPrompt: fallback.optimizedPrompt,
      changes: fallback.changes,
      rationale: fallback.rationale,
      meta: { ...(fallback.meta || {}), timeoutMs },
    })
    return {
      ...saved,
      timeoutMs,
      cached: false,
      cacheKey,
    }
  }
}
