#!/usr/bin/env node
import path from 'node:path'
import { loadLocalEnv } from '../server/lib/load-env.mjs'
import {
  collectGbrainV2FeedRecords,
  exportGbrainV2Feed,
  GBRAIN_V2_FEED_DEFAULT_LIMIT,
  GBRAIN_V2_FEED_DEFAULT_OUT_DIR,
} from '../server/lib/gbrain-v2-feed.mjs'

const DEFAULT_LIMIT = GBRAIN_V2_FEED_DEFAULT_LIMIT
const DEFAULT_OUT_DIR = GBRAIN_V2_FEED_DEFAULT_OUT_DIR

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/gbrain-v2-feed.mjs dry-run [--limit <n>] [--include-raw] [--feed-mode <atom-reader-first|atom-only|reader-first-only>]',
      '  node scripts/gbrain-v2-feed.mjs export [--limit <n>] [--out <dir>] [--include-raw] [--feed-mode <atom-reader-first|atom-only|reader-first-only>] [--clean]',
      '',
      'Examples:',
      '  node scripts/gbrain-v2-feed.mjs dry-run',
      '  node scripts/gbrain-v2-feed.mjs export --out vault/.gbrain-v2-feed --clean',
      '  node scripts/gbrain-v2-feed.mjs export --include-raw --feed-mode atom-only',
    ].join('\n'),
  )
}

function argValue(args, key, fallback = '') {
  const index = args.indexOf(key)
  if (index < 0) return fallback
  return args[index + 1] || fallback
}

function hasFlag(args, key) {
  return args.includes(key)
}

function toNumber(input, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(input)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

async function runDryRun(args) {
  const limit = toNumber(argValue(args, '--limit', String(DEFAULT_LIMIT)), DEFAULT_LIMIT, { min: 1, max: 5000 })
  const includeRaw = hasFlag(args, '--include-raw')
  const feedMode = String(argValue(args, '--feed-mode', 'atom-reader-first') || 'atom-reader-first').trim()
  const result = await collectGbrainV2FeedRecords({ limit, includeRaw, feedMode })
  console.log('[gbrain-v2-feed] dry-run summary')
  console.log(`- feedMode: ${result.feedMode}`)
  console.log(`- atoms: ${result.stats.atoms}`)
  console.log(`- reader-first: ${result.stats.readerFirst}`)
  console.log(`- raw: ${result.stats.raw}`)
  console.log(`- total: ${result.stats.total}`)
}

async function runExport(args) {
  const limit = toNumber(argValue(args, '--limit', String(DEFAULT_LIMIT)), DEFAULT_LIMIT, { min: 1, max: 5000 })
  const outDir = path.resolve(argValue(args, '--out', DEFAULT_OUT_DIR))
  const includeRaw = hasFlag(args, '--include-raw')
  const feedMode = String(argValue(args, '--feed-mode', 'atom-reader-first') || 'atom-reader-first').trim()
  const shouldClean = hasFlag(args, '--clean')
  const result = await exportGbrainV2Feed({
    limit,
    outDir,
    includeRaw,
    clean: shouldClean,
    feedMode,
  })

  console.log('[gbrain-v2-feed] export completed')
  console.log(`- outDir: ${result.outDir}`)
  console.log(`- records: ${result.recordsPath}`)
  console.log(`- manifest: ${result.manifestPath}`)
  console.log(`- feedMode: ${result.feedMode}`)
  console.log(`- total: ${result.stats.total}`)
}

async function main() {
  loadLocalEnv()
  const args = process.argv.slice(2)
  const command = String(args[0] || '').trim().toLowerCase()

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage()
    return
  }

  if (command === 'dry-run') {
    await runDryRun(args.slice(1))
    return
  }

  if (command === 'export') {
    await runExport(args.slice(1))
    return
  }

  usage()
  process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
