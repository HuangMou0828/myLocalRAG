import os from 'node:os'
import path from 'node:path'
import { access, readdir } from 'node:fs/promises'

const home = os.homedir()

function resolveHome(inputPath) {
  if (inputPath.startsWith('~/')) return path.join(home, inputPath.slice(2))
  return inputPath
}

async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function findConversationExportsFromCommonDirs() {
  const roots = [path.join(home, 'Downloads'), path.join(home, 'Desktop'), path.join(home, 'Documents')]
  const matches = []

  for (const root of roots) {
    if (!(await pathExists(root))) continue

    let entries = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const folderPath = path.join(root, entry.name)
      const convPath = path.join(folderPath, 'conversations.json')
      const usersPath = path.join(folderPath, 'users.json')

      if (await pathExists(convPath)) {
        if (await pathExists(usersPath)) {
          matches.push({
            name: `Claude 导出 (${entry.name})`,
            provider: 'claude',
            format: 'claude_export',
            path: folderPath,
            reason: `在 ${path.basename(root)} 目录下发现 Claude 官方导出文件`,
          })
          continue
        }

        matches.push({
          name: `ChatGPT 导出 (${entry.name})`,
          provider: 'chatgpt',
          format: 'chatgpt_export',
          path: folderPath,
          reason: `在 ${path.basename(root)} 目录下发现 conversations.json`,
        })
      }
    }
  }

  return matches
}

export async function discoverSourceSuggestions(existingSources = []) {
  const safeSources = Array.isArray(existingSources) ? existingSources : []
  const existingPathSet = new Set(
    safeSources
      .map((s) => (s && typeof s.path === 'string' ? path.resolve(s.path) : ''))
      .filter(Boolean),
  )

  const staticCandidates = [
    {
      name: 'ChatGPT Desktop 数据目录',
      provider: 'chatgpt',
      format: 'auto',
      path: '~/Library/Application Support/com.openai.chat',
      reason: '常见 ChatGPT 桌面端本地目录',
    },
    {
      name: 'Claude Desktop 数据目录',
      provider: 'claude',
      format: 'auto',
      path: '~/Library/Application Support/Claude',
      reason: '常见 Claude 桌面端本地目录',
    },
    {
      name: 'Anthropic Claude 数据目录',
      provider: 'claude',
      format: 'auto',
      path: '~/Library/Application Support/com.anthropic.claude',
      reason: '常见 Claude 桌面端本地目录（包名）',
    },
    {
      name: 'Gemini 本地资料目录',
      provider: 'gemini',
      format: 'auto',
      path: '~/Documents/gemini',
      reason: '常见手动导出/整理目录',
    },
    {
      name: 'Cursor 项目会话目录',
      provider: 'cursor',
      format: 'auto',
      path: '~/.cursor/projects',
      reason: 'Cursor agent transcripts 常见目录（jsonl）',
    },
    {
      name: 'Codex 会话目录',
      provider: 'codex',
      format: 'auto',
      path: '~/.codex/sessions',
      reason: 'Codex Desktop/CLI 会话常见目录（jsonl）',
    },
    {
      name: 'Claude Code 会话目录',
      provider: 'claude-code',
      format: 'auto',
      path: '~/.claude/projects',
      reason: 'Claude Code 本地会话目录（jsonl）',
    },
    {
      name: 'OpenClaw 会话目录',
      provider: 'codex',
      format: 'auto',
      path: '~/.openclaw/agents/main/sessions',
      reason: 'OpenClaw 原生会话目录（jsonl）',
    },
    {
      name: 'Doubao IndexedDB 目录',
      provider: 'doubao',
      format: 'auto',
      path: '~/Library/Containers/com.bot.neotix.doubao/Data/Library/Application Support/Doubao/Default/IndexedDB',
      reason: '豆包桌面端会话常见存储（leveldb）',
    },
  ]

  const suggestions = []

  for (const candidate of staticCandidates) {
    const resolvedPath = path.resolve(resolveHome(candidate.path))
    if (existingPathSet.has(resolvedPath)) continue

    if (await pathExists(resolvedPath)) {
      suggestions.push({
        ...candidate,
        path: resolvedPath,
      })
    }
  }

  const dynamicMatches = await findConversationExportsFromCommonDirs()

  for (const match of dynamicMatches) {
    const resolvedPath = path.resolve(match.path)
    if (existingPathSet.has(resolvedPath)) continue
    if (suggestions.some((s) => path.resolve(s.path) === resolvedPath)) continue

    suggestions.push({
      ...match,
      path: resolvedPath,
    })
  }

  return suggestions
}
