import fs from 'node:fs'
import path from 'node:path'
import { scorePrompt, scorePrompts, getPromptRubric } from '../server/lib/prompt-scorer.mjs'

function parseArgs(argv) {
  const args = {
    text: '',
    file: '',
    rubric: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]
    if (current === '--text') args.text = argv[i + 1] || ''
    if (current === '--file') args.file = argv[i + 1] || ''
    if (current === '--rubric') args.rubric = true
  }
  return args
}

function printUsage() {
  console.log(`Usage:
  node scripts/score-prompts.mjs --text "你的 prompt"
  node scripts/score-prompts.mjs --file ./prompts.json
  node scripts/score-prompts.mjs --rubric`)
}

function readPromptsFromFile(inputFile) {
  const full = path.resolve(inputFile)
  const content = fs.readFileSync(full, 'utf-8')
  if (full.endsWith('.txt') || full.endsWith('.md')) {
    return [content]
  }
  const data = JSON.parse(content)
  if (Array.isArray(data)) return data
  if (typeof data?.prompt === 'string') return [data.prompt]
  if (Array.isArray(data?.prompts)) return data.prompts
  throw new Error('文件格式不支持，请使用 txt/md 或 JSON（array / {prompt} / {prompts}）')
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.rubric) {
    console.log(JSON.stringify(getPromptRubric(), null, 2))
    return
  }

  if (args.text) {
    console.log(JSON.stringify(scorePrompt(args.text, { promptId: 'manual_text' }), null, 2))
    return
  }

  if (args.file) {
    const prompts = readPromptsFromFile(args.file)
    const result = prompts.length > 1 ? scorePrompts(prompts) : [scorePrompt(prompts[0], { promptId: 'file_input_1' })]
    console.log(JSON.stringify(result, null, 2))
    return
  }

  printUsage()
}

main()
