import { promises as fs } from 'node:fs'
import path from 'node:path'

const cwd = process.cwd()
const srcRoot = path.join(cwd, 'src')
const featureRoot = path.join(srcRoot, 'features')
const entryFiles = new Set([
  toPosix(path.join(srcRoot, 'App.vue')),
  toPosix(path.join(srcRoot, 'main.ts')),
])

const allowedCrossFeatureDeps = new Set([
  'bug-inbox->bug-trace',
  'message-tags->session-flow',
  'prompt-score->session-flow',
  'session-data->session-filter',
])

const extensions = ['.ts', '.tsx', '.js', '.mjs', '.vue']
const sourceFiles = await collectSourceFiles(srcRoot)

const violations = []
const graph = new Map()
let scannedImports = 0
let internalImports = 0

for (const file of sourceFiles) {
  const content = await fs.readFile(file, 'utf8')
  const specs = extractImports(content)
  const fromFeature = getFeatureName(file)

  for (const spec of specs) {
    scannedImports += 1
    const resolved = await resolveInternalImport(file, spec)
    if (!resolved) {
      continue
    }

    internalImports += 1
    const toFeature = getFeatureName(resolved)

    if (fromFeature && entryFiles.has(toPosix(resolved))) {
      violations.push(
        `${shorten(file)} imports entry file ${shorten(resolved)}; feature modules cannot depend on entry layer.`,
      )
    }

    if (!fromFeature || !toFeature || fromFeature === toFeature) {
      continue
    }

    addEdge(graph, fromFeature, toFeature)

    if (fromFeature !== 'app' && toFeature === 'app') {
      violations.push(
        `${fromFeature} -> app is not allowed (${shorten(file)} -> ${shorten(resolved)}).`,
      )
      continue
    }

    if (fromFeature === 'app') {
      continue
    }

    const dep = `${fromFeature}->${toFeature}`
    if (!allowedCrossFeatureDeps.has(dep)) {
      violations.push(
        `Cross-feature dependency not allowed: ${dep} (${shorten(file)} -> ${shorten(resolved)}).`,
      )
    }
  }
}

const cycles = findCycles(graph).filter((cycle) => !cycle.includes('app'))
for (const cycle of cycles) {
  violations.push(`Feature cycle detected: ${cycle.join(' -> ')}`)
}

if (violations.length > 0) {
  console.error('Architecture check failed.\n')
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

const crossFeatureEdges = countEdges(graph)
console.log(
  [
    'Architecture check passed.',
    `Scanned files: ${sourceFiles.length}`,
    `Scanned imports: ${scannedImports}`,
    `Internal imports: ${internalImports}`,
    `Cross-feature edges: ${crossFeatureEdges}`,
  ].join('\n'),
)

function toPosix(filePath) {
  return filePath.split(path.sep).join('/')
}

function shorten(filePath) {
  return toPosix(path.relative(cwd, filePath))
}

async function collectSourceFiles(dir) {
  const result = []
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...(await collectSourceFiles(fullPath)))
      continue
    }

    if (extensions.includes(path.extname(entry.name))) {
      result.push(fullPath)
    }
  }

  return result
}

function extractImports(content) {
  const staticPattern = /(?:import|export)\s+[\s\S]*?\sfrom\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g
  const dynamicPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  const specs = []

  for (const match of content.matchAll(staticPattern)) {
    const spec = match[1] ?? match[2]
    if (spec) {
      specs.push(spec)
    }
  }

  for (const match of content.matchAll(dynamicPattern)) {
    if (match[1]) {
      specs.push(match[1])
    }
  }

  return specs
}

async function resolveInternalImport(fromFile, spec) {
  if (spec.startsWith('@/')) {
    const target = path.join(srcRoot, spec.slice(2))
    return resolveWithExtensions(target)
  }

  if (spec.startsWith('./') || spec.startsWith('../')) {
    const target = path.resolve(path.dirname(fromFile), spec)
    return resolveWithExtensions(target)
  }

  return null
}

async function resolveWithExtensions(basePath) {
  const candidateFiles = []
  if (path.extname(basePath)) {
    candidateFiles.push(basePath)
  } else {
    for (const ext of extensions) {
      candidateFiles.push(`${basePath}${ext}`)
    }
    for (const ext of extensions) {
      candidateFiles.push(path.join(basePath, `index${ext}`))
    }
  }

  for (const candidate of candidateFiles) {
    if (await isFile(candidate)) {
      return candidate
    }
  }

  return null
}

async function isFile(filePath) {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}

function getFeatureName(filePath) {
  const normalized = toPosix(filePath)
  const normalizedFeatureRoot = toPosix(featureRoot)
  if (!normalized.startsWith(`${normalizedFeatureRoot}/`)) {
    return null
  }

  const relative = normalized.slice(normalizedFeatureRoot.length + 1)
  const [featureName] = relative.split('/')
  return featureName || null
}

function addEdge(graphMap, from, to) {
  if (!graphMap.has(from)) {
    graphMap.set(from, new Set())
  }
  graphMap.get(from).add(to)
}

function countEdges(graphMap) {
  let count = 0
  for (const deps of graphMap.values()) {
    count += deps.size
  }
  return count
}

function findCycles(graphMap) {
  const nodes = new Set()
  for (const [from, deps] of graphMap.entries()) {
    nodes.add(from)
    for (const to of deps) {
      nodes.add(to)
    }
  }

  const status = new Map()
  const stack = []
  const cycles = []
  const cycleSet = new Set()

  for (const node of nodes) {
    if (!status.has(node)) {
      dfs(node)
    }
  }

  return cycles

  function dfs(node) {
    status.set(node, 1)
    stack.push(node)

    const deps = graphMap.get(node) ?? new Set()
    for (const dep of deps) {
      const depStatus = status.get(dep) ?? 0
      if (depStatus === 0) {
        dfs(dep)
        continue
      }

      if (depStatus === 1) {
        const startIndex = stack.indexOf(dep)
        const cyclePath = [...stack.slice(startIndex), dep]
        const key = cyclePath.join('>')
        if (!cycleSet.has(key)) {
          cycleSet.add(key)
          cycles.push(cyclePath)
        }
      }
    }

    stack.pop()
    status.set(node, 2)
  }
}
