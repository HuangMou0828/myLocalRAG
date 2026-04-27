#!/usr/bin/env node
import { loadLocalEnv } from '../server/lib/load-env.mjs'

loadLocalEnv()

function usage() {
  console.log([
    'Usage:',
    '  node scripts/gbrain-v2-mvp-auto.mjs dry-run [--max-items <n>] [--min-confidence <n>] [--base-url <url>] [--write-report <0|1>]',
    '  node scripts/gbrain-v2-mvp-auto.mjs apply   [--max-items <n>] [--min-confidence <n>] [--base-url <url>] [--write-report <0|1>]',
    '',
    'Examples:',
    '  npm run gbrain:v2:mvp:auto:dry',
    '  npm run gbrain:v2:mvp:auto:apply',
    '  npm run gbrain:v2:mvp:auto:dry -- --max-items 50 --min-confidence 0.88',
  ].join('\n'))
}

function normalizeText(input) {
  return String(input || '').trim()
}

function argValue(args, key, fallback = '') {
  const index = args.indexOf(key)
  if (index < 0) return fallback
  return args[index + 1] || fallback
}

function hasFlag(args, key) {
  return Array.isArray(args) && args.includes(key)
}

function toNumber(input, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(input)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function toBooleanFlag(input, fallback = true) {
  const normalized = normalizeText(input).toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

async function run({
  dryRun = true,
  maxItems = 30,
  minConfidence = 0.82,
  baseUrl = 'http://127.0.0.1:3030',
  writeReport = true,
} = {}) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/wiki-vault/promotion-auto-mvp`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dryRun: Boolean(dryRun),
      maxItems: Math.max(1, Math.min(500, Number(maxItems || 30))),
      minConfidence: Math.max(0, Math.min(1, Number(minConfidence || 0.82))),
      writeReport: Boolean(writeReport),
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(String(payload?.error || `HTTP ${response.status}`))
  }
  return payload
}

async function main() {
  const args = process.argv.slice(2)
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    usage()
    return
  }
  const command = normalizeText(args[0]).toLowerCase()
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage()
    return
  }

  const dryRun = command !== 'apply'
  if (!dryRun && command !== 'apply') {
    usage()
    process.exitCode = 1
    return
  }

  const maxItems = toNumber(argValue(args, '--max-items', '30'), 30, { min: 1, max: 500 })
  const minConfidence = toNumber(argValue(args, '--min-confidence', '0.82'), 0.82, { min: 0, max: 1 })
  const baseUrl = normalizeText(argValue(args, '--base-url', process.env.KB_SERVER_BASE || 'http://127.0.0.1:3030'))
  const writeReport = toBooleanFlag(argValue(args, '--write-report', '1'), true)

  const result = await run({
    dryRun,
    maxItems,
    minConfidence,
    baseUrl,
    writeReport,
  })

  const autoSummary = result?.autoSummary || {}
  console.log('[gbrain-v2-mvp-auto] completed')
  console.log(`- mode: ${dryRun ? 'dry-run' : 'apply'}`)
  console.log(`- baseUrl: ${baseUrl}`)
  console.log(`- scanned: ${Number(autoSummary.scanned || 0)}`)
  console.log(`- approved: ${Number(autoSummary.approved || 0)}`)
  console.log(`- skipped: ${Number(autoSummary.skipped || 0)}`)
  console.log(`- failed: ${Number(autoSummary.failed || 0)}`)
  console.log(`- minConfidence: ${Number(result?.minConfidence || minConfidence)}`)

  const reasons = autoSummary?.reasons && typeof autoSummary.reasons === 'object'
    ? autoSummary.reasons
    : {}
  const topReasons = Object.entries(reasons)
    .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))
    .slice(0, 8)
  if (topReasons.length) {
    console.log('- top skip/fail reasons:')
    for (const [reason, count] of topReasons) {
      console.log(`  - ${reason}: ${Number(count || 0)}`)
    }
  }

  if (!result?.ok) process.exitCode = 2
}

main().catch((error) => {
  console.error(String(error?.message || error || 'gbrain-v2-mvp-auto failed'))
  process.exitCode = 1
})
