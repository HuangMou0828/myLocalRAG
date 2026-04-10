import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const serverFile = path.join(root, 'server', 'index.mjs')
const openapiFile = path.join(root, 'docs', 'api', 'openapi.yaml')

function normalizeMethod(method) {
  return String(method || '').trim().toUpperCase()
}

function normalizePath(pathname) {
  return String(pathname || '').trim()
}

function toSignature(method, pathname) {
  return `${normalizeMethod(method)} ${normalizePath(pathname)}`
}

function parseServerRoutes(sourceText) {
  const routes = new Set()

  const directPattern = /req\.method === '([A-Z]+)'\s*&&\s*url\.pathname === '([^']+)'/g
  let match = null
  while ((match = directPattern.exec(sourceText))) {
    const method = normalizeMethod(match[1])
    const pathname = normalizePath(match[2])
    if (!pathname.startsWith('/api/')) continue
    routes.add(toSignature(method, pathname))
  }

  // 兼容 `req.method === 'POST' && (url.pathname === '/a' || url.pathname === '/b')` 这种写法
  const aliasPattern = /url\.pathname === '([^']+)'/g
  while ((match = aliasPattern.exec(sourceText))) {
    const pathname = normalizePath(match[1])
    if (!pathname.startsWith('/api/')) continue

    const alreadyTracked = Array.from(routes).some((sig) => sig.endsWith(` ${pathname}`))
    if (alreadyTracked) continue

    const windowStart = Math.max(0, match.index - 300)
    const windowText = sourceText.slice(windowStart, match.index + 120)
    const methodMatches = [...windowText.matchAll(/req\.method === '([A-Z]+)'/g)]
    const inferred = methodMatches.at(-1)?.[1]
    if (!inferred) continue

    routes.add(toSignature(inferred, pathname))
  }

  return routes
}

function parseOpenApiRoutes(openapiText) {
  const routes = new Set()
  const lines = openapiText.split('\n')
  let currentPath = ''

  for (const line of lines) {
    const pathMatch = line.match(/^  (\/api\/[^:]+):\s*$/)
    if (pathMatch) {
      currentPath = normalizePath(pathMatch[1])
      continue
    }

    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/)
    if (methodMatch && currentPath) {
      routes.add(toSignature(methodMatch[1], currentPath))
    }
  }

  return routes
}

function sorted(list) {
  return [...list].sort((a, b) => a.localeCompare(b))
}

async function main() {
  const [serverText, openapiText] = await Promise.all([
    readFile(serverFile, 'utf-8'),
    readFile(openapiFile, 'utf-8'),
  ])

  const serverRoutes = parseServerRoutes(serverText)
  const openapiRoutes = parseOpenApiRoutes(openapiText)

  const missingInOpenApi = sorted([...serverRoutes].filter((sig) => !openapiRoutes.has(sig)))
  const onlyInOpenApi = sorted([...openapiRoutes].filter((sig) => !serverRoutes.has(sig)))

  if (!missingInOpenApi.length && !onlyInOpenApi.length) {
    console.log(`[api-docs] OK: ${serverRoutes.size} routes are in sync.`)
    return
  }

  if (missingInOpenApi.length) {
    console.error('[api-docs] Missing in docs/api/openapi.yaml:')
    for (const item of missingInOpenApi) console.error(`  - ${item}`)
  }

  if (onlyInOpenApi.length) {
    console.error('[api-docs] Extra routes in docs/api/openapi.yaml:')
    for (const item of onlyInOpenApi) console.error(`  - ${item}`)
  }

  process.exitCode = 1
}

main().catch((error) => {
  console.error(`[api-docs] Failed: ${String(error)}`)
  process.exit(1)
})
