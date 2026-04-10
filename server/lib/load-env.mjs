import fs from 'node:fs'
import path from 'node:path'

let loaded = false

function stripQuotes(value) {
  const text = String(value || '').trim()
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1)
  }
  return text
}

export function loadLocalEnv() {
  if (loaded) return
  loaded = true

  const envPath = path.resolve('.env')
  if (!fs.existsSync(envPath)) return

  const raw = fs.readFileSync(envPath, 'utf-8')
  for (const line of raw.split('\n')) {
    const text = line.trim()
    if (!text || text.startsWith('#')) continue
    const eq = text.indexOf('=')
    if (eq <= 0) continue
    const key = text.slice(0, eq).trim()
    const value = stripQuotes(text.slice(eq + 1))
    if (!key) continue
    if (typeof process.env[key] === 'undefined') {
      process.env[key] = value
    }
  }
}
