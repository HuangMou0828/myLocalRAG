import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const OBSIDIAN_CLI_BIN = String(process.env.KB_OBSIDIAN_CLI_BIN || 'obsidian').trim() || 'obsidian'
const OBSIDIAN_CLI_VAULT = String(process.env.KB_OBSIDIAN_CLI_VAULT || 'vault').trim() || 'vault'
const OBSIDIAN_CLI_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.KB_OBSIDIAN_CLI_ENABLED || '1').trim())
const OBSIDIAN_CLI_AUTO_LAUNCH = !/^(0|false|off|no)$/i.test(String(process.env.KB_OBSIDIAN_CLI_AUTO_LAUNCH || '1').trim())

let readyUntil = 0
let launchPromise = null

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))))
}

function normalizeParts(parts = []) {
  return (Array.isArray(parts) ? parts : [parts])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
}

function buildArgs(parts = []) {
  return [`vault=${OBSIDIAN_CLI_VAULT}`, ...normalizeParts(parts)]
}

function parseJsonSafely(stdout = '') {
  const raw = String(stdout || '').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {}
  const objectStart = raw.indexOf('{')
  const arrayStart = raw.indexOf('[')
  const start = [objectStart, arrayStart].filter((value) => value >= 0).sort((a, b) => a - b)[0]
  if (start === undefined) return null
  const candidate = raw.slice(start).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

function isNotReadyError(error) {
  const text = `${error?.message || ''}\n${error?.stderr || ''}`
  return /unable to find obsidian|please make sure obsidian is running|econnrefused|timed out/i.test(text)
}

async function execObsidian(parts = [], timeoutMs = 4000) {
  return execFileAsync(OBSIDIAN_CLI_BIN, buildArgs(parts), {
    timeout: Math.max(500, Number(timeoutMs || 0)),
    maxBuffer: 8 * 1024 * 1024,
  })
}

async function launchObsidianApp() {
  if (process.platform !== 'darwin') return false
  try {
    await execFileAsync('open', ['-a', 'Obsidian'], {
      timeout: 2500,
      maxBuffer: 1024 * 1024,
    })
    return true
  } catch {
    return false
  }
}

export function isObsidianCliEnabled() {
  return OBSIDIAN_CLI_ENABLED
}

export async function ensureObsidianReady(options = {}) {
  if (!OBSIDIAN_CLI_ENABLED) return false
  const probeTimeoutMs = Math.max(500, Number(options.probeTimeoutMs || 1200))
  const readyTimeoutMs = Math.max(1000, Number(options.readyTimeoutMs || 5000))
  const autoLaunch = options.autoLaunch === undefined ? OBSIDIAN_CLI_AUTO_LAUNCH : Boolean(options.autoLaunch)
  if (Date.now() < readyUntil) return true

  try {
    await execObsidian(['vault'], probeTimeoutMs)
    readyUntil = Date.now() + 20000
    return true
  } catch {}

  if (!autoLaunch) return false

  if (!launchPromise) {
    launchPromise = (async () => {
      const launched = await launchObsidianApp()
      if (!launched) return false
      const deadline = Date.now() + readyTimeoutMs
      while (Date.now() < deadline) {
        await sleep(450)
        try {
          await execObsidian(['vault'], probeTimeoutMs)
          readyUntil = Date.now() + 20000
          return true
        } catch {}
      }
      return false
    })().finally(() => {
      launchPromise = null
    })
  }

  try {
    return await launchPromise
  } catch {
    return false
  }
}

export async function runObsidianCli(parts = [], options = {}) {
  if (!OBSIDIAN_CLI_ENABLED) {
    throw new Error('Obsidian CLI is disabled')
  }
  const timeoutMs = Math.max(800, Number(options.timeoutMs || 8000))
  const autoLaunch = options.autoLaunch === undefined ? OBSIDIAN_CLI_AUTO_LAUNCH : Boolean(options.autoLaunch)
  const ensureReady = options.ensureReady !== false

  if (ensureReady) {
    const ready = await ensureObsidianReady({
      autoLaunch,
      readyTimeoutMs: options.readyTimeoutMs,
      probeTimeoutMs: options.probeTimeoutMs,
    })
    if (!ready) throw new Error('Obsidian is not ready')
  }

  try {
    return await execObsidian(parts, timeoutMs)
  } catch (error) {
    if (!isNotReadyError(error)) throw error
    if (!autoLaunch) throw error
    const ready = await ensureObsidianReady({
      autoLaunch,
      readyTimeoutMs: options.readyTimeoutMs,
      probeTimeoutMs: options.probeTimeoutMs,
    })
    if (!ready) throw error
    return execObsidian(parts, timeoutMs)
  }
}

export async function runObsidianCliJson(parts = [], options = {}) {
  const result = await runObsidianCli(parts, options)
  const parsed = parseJsonSafely(result?.stdout || '')
  if (parsed === null) {
    throw new Error(`Invalid JSON output from Obsidian CLI: ${normalizeParts(parts).join(' ')}`)
  }
  return parsed
}

