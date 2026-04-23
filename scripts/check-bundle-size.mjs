import { promises as fs } from 'node:fs'
import path from 'node:path'

const cwd = process.cwd()
const distDir = path.join(cwd, 'dist')
const indexHtmlPath = path.join(distDir, 'index.html')
const assetsDir = path.join(distDir, 'assets')

const budget = {
  entryJsKb: readPositiveNumber('BUNDLE_BUDGET_ENTRY_JS_KB', 300),
  entryCssKb: readPositiveNumber('BUNDLE_BUDGET_ENTRY_CSS_KB', 280),
  maxAsyncJsKb: readPositiveNumber('BUNDLE_BUDGET_MAX_ASYNC_JS_KB', 320),
}

await assertPathExists(indexHtmlPath, 'file')
await assertPathExists(assetsDir, 'directory')

const indexHtml = await fs.readFile(indexHtmlPath, 'utf8')
const { entryScripts, entryStyles } = extractEntryAssets(indexHtml)

if (entryScripts.length === 0) {
  fail(`[bundle-size] No entry script found in ${shorten(indexHtmlPath)}. Run npm run build first.`)
}

const entryJsStats = await collectStats(entryScripts, distDir)
const entryCssStats = await collectStats(entryStyles, distDir)
const allJsStats = await collectAllJsStats(assetsDir)

const entryJsPathSet = new Set(entryJsStats.map((item) => path.resolve(item.path)))
const asyncJsStats = allJsStats.filter((item) => !entryJsPathSet.has(path.resolve(item.path)))
const largestAsyncJs = asyncJsStats.sort((a, b) => b.bytes - a.bytes)[0] ?? null

const entryJsBytes = sumBytes(entryJsStats)
const entryCssBytes = sumBytes(entryCssStats)

const violations = []
if (entryJsBytes > kbToBytes(budget.entryJsKb)) {
  violations.push(
    `Entry JS ${formatKb(entryJsBytes)} kB exceeds budget ${formatKb(kbToBytes(budget.entryJsKb))} kB.`,
  )
}
if (entryCssBytes > kbToBytes(budget.entryCssKb)) {
  violations.push(
    `Entry CSS ${formatKb(entryCssBytes)} kB exceeds budget ${formatKb(kbToBytes(budget.entryCssKb))} kB.`,
  )
}
if (largestAsyncJs && largestAsyncJs.bytes > kbToBytes(budget.maxAsyncJsKb)) {
  violations.push(
    `Largest async JS ${shorten(largestAsyncJs.path)} is ${formatKb(largestAsyncJs.bytes)} kB, exceeds budget ${formatKb(kbToBytes(budget.maxAsyncJsKb))} kB.`,
  )
}

console.log(`[bundle-size] Entry JS: ${formatKb(entryJsBytes)} kB / ${budget.entryJsKb.toFixed(2)} kB`)
console.log(`[bundle-size] Entry CSS: ${formatKb(entryCssBytes)} kB / ${budget.entryCssKb.toFixed(2)} kB`)
if (largestAsyncJs) {
  console.log(
    `[bundle-size] Largest async JS: ${shorten(largestAsyncJs.path)} ${formatKb(largestAsyncJs.bytes)} kB / ${budget.maxAsyncJsKb.toFixed(2)} kB`,
  )
} else {
  console.log(`[bundle-size] Largest async JS: N/A / ${budget.maxAsyncJsKb.toFixed(2)} kB`)
}

if (violations.length > 0) {
  console.error('[bundle-size] Check failed.')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log('[bundle-size] Check passed.')

function extractEntryAssets(html) {
  const entryScripts = []
  const entryStyles = []

  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0])
    if (attrs.src) {
      entryScripts.push(attrs.src)
    }
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0])
    const rel = (attrs.rel || '').toLowerCase()
    if (rel.includes('stylesheet') && attrs.href) {
      entryStyles.push(attrs.href)
    }
  }

  return {
    entryScripts: dedupe(entryScripts),
    entryStyles: dedupe(entryStyles),
  }
}

function parseAttributes(tag) {
  const attrs = {}
  for (const match of tag.matchAll(/\b([^\s=/>]+)\s*=\s*["']([^"']*)["']/g)) {
    attrs[String(match[1]).toLowerCase()] = String(match[2])
  }
  return attrs
}

async function collectStats(refs, distRoot) {
  const stats = []
  for (const ref of refs) {
    const filePath = resolveDistAssetPath(ref, distRoot)
    if (!filePath) {
      continue
    }
    await assertPathExists(filePath, 'file')
    const file = await fs.stat(filePath)
    stats.push({ path: filePath, bytes: file.size })
  }
  return stats
}

async function collectAllJsStats(rootDir) {
  const files = await collectFilesRecursive(rootDir)
  const jsFiles = files.filter((filePath) => filePath.endsWith('.js'))
  const stats = await Promise.all(
    jsFiles.map(async (filePath) => {
      const file = await fs.stat(filePath)
      return { path: filePath, bytes: file.size }
    }),
  )
  return stats
}

async function collectFilesRecursive(dir) {
  const result = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...(await collectFilesRecursive(fullPath)))
      continue
    }
    if (entry.isFile()) {
      result.push(fullPath)
    }
  }
  return result
}

function resolveDistAssetPath(assetRef, distRoot) {
  if (!assetRef || /^https?:\/\//i.test(assetRef)) {
    return null
  }

  const cleanRef = assetRef.split('?')[0].split('#')[0]
  const normalized = cleanRef
    .replace(/^[./]+/, '')
    .replace(/^\/+/, '')

  if (!normalized) {
    return null
  }

  const resolved = path.resolve(distRoot, normalized)
  const distResolved = path.resolve(distRoot)
  if (!resolved.startsWith(distResolved + path.sep) && resolved !== distResolved) {
    fail(`[bundle-size] Unexpected asset path: ${assetRef}`)
  }
  return resolved
}

function dedupe(items) {
  return [...new Set(items)]
}

function sumBytes(items) {
  let total = 0
  for (const item of items) {
    total += item.bytes
  }
  return total
}

function kbToBytes(kb) {
  return kb * 1000
}

function formatKb(bytes) {
  return (bytes / 1000).toFixed(2)
}

function readPositiveNumber(envName, fallback) {
  const raw = process.env[envName]
  if (!raw) {
    return fallback
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`[bundle-size] Invalid ${envName}: ${raw}`)
  }
  return parsed
}

async function assertPathExists(targetPath, kind) {
  try {
    const stat = await fs.stat(targetPath)
    if (kind === 'file' && !stat.isFile()) {
      fail(`[bundle-size] Expected file: ${shorten(targetPath)}`)
    }
    if (kind === 'directory' && !stat.isDirectory()) {
      fail(`[bundle-size] Expected directory: ${shorten(targetPath)}`)
    }
  } catch {
    fail(`[bundle-size] Missing ${kind}: ${shorten(targetPath)}. Run npm run build first.`)
  }
}

function shorten(filePath) {
  return path.relative(cwd, filePath).split(path.sep).join('/')
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
