#!/usr/bin/env node
import { loadLocalEnv } from '../server/lib/load-env.mjs'
import { loadSessionsByIds, querySessions } from '../server/lib/scanner.mjs'
import { buildPromotionQueue, ensureVaultScaffold, publishSessionsToVault, rebuildVaultIndex, repairVaultReadableLinks } from '../server/lib/wiki-vault.mjs'

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/wiki-vault.mjs init',
      '  node scripts/wiki-vault.mjs publish [--limit <n>] [--provider <name>]',
      '  node scripts/wiki-vault.mjs publish --session <id1,id2,...>',
      '  node scripts/wiki-vault.mjs refresh-published',
      '  node scripts/wiki-vault.mjs rebuild-index',
      '  node scripts/wiki-vault.mjs rebuild-promotion-queue',
      '  node scripts/wiki-vault.mjs repair-readable-links',
      '',
      'Examples:',
      '  node scripts/wiki-vault.mjs init',
      '  node scripts/wiki-vault.mjs publish --limit 5',
      '  node scripts/wiki-vault.mjs publish --provider cursor --limit 10',
      '  node scripts/wiki-vault.mjs publish --session cursor:abc123,cursor:def456',
      '  node scripts/wiki-vault.mjs refresh-published',
      '  node scripts/wiki-vault.mjs repair-readable-links',
    ].join('\n'),
  )
}

function argValue(args, key) {
  const index = args.indexOf(key)
  if (index < 0) return ''
  return args[index + 1] || ''
}

function normalizeCsv(input) {
  return String(input || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

async function runInit() {
  const paths = await ensureVaultScaffold()
  console.log(`Vault initialized: ${paths.root}`)
  console.log(`Open in Obsidian: ${paths.root}`)
}

async function runPublish(args) {
  const explicitIds = normalizeCsv(argValue(args, '--session'))
  const provider = argValue(args, '--provider').trim().toLowerCase()
  const limit = Math.max(1, Number(argValue(args, '--limit') || 10))

  let sessions = []
  if (explicitIds.length) {
    sessions = await loadSessionsByIds(explicitIds)
  } else {
    const index = await querySessions({ provider })
    const rawSessions = Array.isArray(index?.sessions) ? index.sessions : []
    sessions = rawSessions.slice(0, limit)
  }

  if (!sessions.length) {
    console.log('No sessions matched the publish query.')
    return
  }

  const result = await publishSessionsToVault(sessions)
  console.log(`Vault: ${result.vaultDir}`)
  console.log(`Published pages: ${result.published.length}`)
  for (const item of result.published.slice(0, 20)) {
    console.log(`- ${item.relativePath} (${item.provider || 'unknown'})`)
  }
}

async function runRebuildIndex() {
  const result = await rebuildVaultIndex()
  console.log(`Vault index rebuilt: ${result.vaultDir}`)
  console.log(`Entries: ${result.entries.length}`)
}

async function runRefreshPublished() {
  await ensureVaultScaffold()
  const index = await querySessions({ provider: '' })
  const sessions = Array.isArray(index?.sessions) ? index.sessions : []
  if (!sessions.length) {
    console.log('No sessions found in the database.')
    return
  }

  const result = await publishSessionsToVault(sessions, {
    pruneMissingSources: true,
  })
  console.log(`Vault: ${result.vaultDir}`)
  console.log(`Refreshed pages: ${result.published.length}`)
}

async function runRebuildPromotionQueue() {
  const result = await buildPromotionQueue()
  console.log(`Promotion queue rebuilt: ${result.reportPath}`)
  console.log(`Queued items: ${result.summary?.totalItems || 0}`)
}

async function runRepairReadableLinks() {
  const result = await repairVaultReadableLinks()
  console.log(`Vault: ${result.vaultDir}`)
  console.log(`Changed files: ${result.changedFiles}`)
  console.log(`Repaired links: ${result.replacements}`)
}

async function main() {
  loadLocalEnv()
  const args = process.argv.slice(2)
  const command = args[0] || ''

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    usage()
    return
  }

  if (command === 'init') {
    await runInit()
    return
  }

  if (command === 'publish') {
    await runPublish(args.slice(1))
    return
  }

  if (command === 'rebuild-index') {
    await runRebuildIndex()
    return
  }

  if (command === 'refresh-published') {
    await runRefreshPublished()
    return
  }

  if (command === 'rebuild-promotion-queue') {
    await runRebuildPromotionQueue()
    return
  }

  if (command === 'repair-readable-links') {
    await runRepairReadableLinks()
    return
  }

  usage()
  process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
