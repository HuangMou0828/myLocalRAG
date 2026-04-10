import fs from 'node:fs'
import path from 'node:path'
import { optimizePrompt } from '../server/lib/prompt-optimizer.mjs'
import { loadLocalEnv } from '../server/lib/load-env.mjs'

loadLocalEnv()

function parseArgs(argv) {
  const args = {
    text: '',
    file: '',
    taskType: '',
    model: '',
    language: '',
    force: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]
    if (current === '--text') args.text = argv[i + 1] || ''
    if (current === '--file') args.file = argv[i + 1] || ''
    if (current === '--task-type') args.taskType = argv[i + 1] || ''
    if (current === '--model') args.model = argv[i + 1] || ''
    if (current === '--language') args.language = argv[i + 1] || ''
    if (current === '--force') args.force = true
  }
  return args
}

function printUsage() {
  console.log(`Usage:
  node scripts/optimize-prompt.mjs --text "你的 prompt" --task-type coding --model MiniMax-M2.7-highspeed --language zh-CN
  node scripts/optimize-prompt.mjs --file ./prompt.json`)
}

function readInputFromFile(inputFile) {
  const full = path.resolve(inputFile)
  const content = fs.readFileSync(full, 'utf-8')
  if (full.endsWith('.txt') || full.endsWith('.md')) {
    return { prompt: content }
  }
  const data = JSON.parse(content)
  if (typeof data?.prompt === 'string') return data
  throw new Error('文件格式不支持，请使用 txt/md 或 JSON({prompt,contextMessages,constraints,taskType})')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let payload = null

  if (args.text) {
    payload = {
      prompt: args.text,
      taskType: args.taskType || '',
      model: args.model || '',
      language: args.language || '',
      forceRegenerate: args.force,
    }
  } else if (args.file) {
    payload = readInputFromFile(args.file)
  } else {
    printUsage()
    return
  }

  const result = await optimizePrompt(payload)
  console.log(JSON.stringify(result, null, 2))
}

void main()
