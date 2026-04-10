import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const serverFile = path.join(root, 'server', 'index.mjs')
const fullSpecFile = path.join(root, 'docs', 'api', 'openapi.yaml')
const publicSpecFile = path.join(root, 'docs', 'api', 'openapi.public.yaml')

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
  const [serverText, fullSpecText, publicSpecText] = await Promise.all([
    readFile(serverFile, 'utf-8'),
    readFile(fullSpecFile, 'utf-8'),
    readFile(publicSpecFile, 'utf-8'),
  ])

  const serverRoutes = parseServerRoutes(serverText)
  const fullRoutes = parseOpenApiRoutes(fullSpecText)
  const publicRoutes = parseOpenApiRoutes(publicSpecText)

  if (!publicRoutes.size) {
    console.error('[api-docs-public] public spec has no /api routes.')
    process.exit(1)
  }

  const missingInServer = sorted([...publicRoutes].filter((sig) => !serverRoutes.has(sig)))
  const missingInFull = sorted([...publicRoutes].filter((sig) => !fullRoutes.has(sig)))

  if (!missingInServer.length && !missingInFull.length) {
    console.log(`[api-docs-public] OK: ${publicRoutes.size} public routes are valid.`)
    return
  }

  if (missingInServer.length) {
    console.error('[api-docs-public] Public spec routes missing in server/index.mjs:')
    for (const item of missingInServer) console.error(`  - ${item}`)
  }

  if (missingInFull.length) {
    console.error('[api-docs-public] Public spec routes missing in docs/api/openapi.yaml:')
    for (const item of missingInFull) console.error(`  - ${item}`)
  }

  process.exit(1)
}

main().catch((error) => {
  console.error(`[api-docs-public] Failed: ${String(error)}`)
  process.exit(1)
})
