#!/usr/bin/env node
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { adaptFolderToStandard } from '../server/lib/adapter.mjs'

function usage() {
  console.log(
    [
      'Usage:',
      '  node scripts/adapt-exports.mjs --input <dir> [--out <file>]',
      '',
      'Example:',
      '  node scripts/adapt-exports.mjs --input /Users/hm/Downloads/data_demo --out /Users/hm/Downloads/data_demo/standardized.json',
    ].join('\n'),
  )
}

function argValue(args, key) {
  const index = args.indexOf(key)
  if (index < 0) return ''
  return args[index + 1] || ''
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    usage()
    return
  }

  const inputDir = argValue(args, '--input')
  const outputFile = argValue(args, '--out')
  if (!inputDir) {
    usage()
    process.exitCode = 1
    return
  }

  const standard = await adaptFolderToStandard(inputDir)
  const resolvedOutput = outputFile
    ? path.resolve(outputFile)
    : path.join(process.cwd(), 'standardized-sessions.json')

  await fs.writeFile(resolvedOutput, JSON.stringify(standard, null, 2), 'utf-8')

  console.log(`Input: ${standard.sourceRoot}`)
  console.log(`Output: ${resolvedOutput}`)
  console.log(`Sessions: ${standard.count}`)
  console.log(`Issues: ${standard.issues.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
