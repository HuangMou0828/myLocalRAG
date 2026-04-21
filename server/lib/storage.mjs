import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DATA_DIR = path.resolve(moduleDir, '..', 'data')
const dataDir = path.resolve(process.env.KB_WORKSPACE || process.env.KB_DATA_DIR || DEFAULT_DATA_DIR)

export const files = {
  sources: path.join(dataDir, 'sources.json'),
  index: path.join(dataDir, 'index.json'),
  db: path.join(dataDir, 'kb.sqlite'),
}
export { dataDir }

async function ensure() {
  await mkdir(dataDir, { recursive: true })
}

export async function readJson(filePath, fallback) {
  await ensure()
  try {
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export async function writeJson(filePath, data) {
  await ensure()
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}
