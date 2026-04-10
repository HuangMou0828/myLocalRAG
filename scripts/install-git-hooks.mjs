import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const hooksDir = join(root, '.githooks')

if (!existsSync(join(root, '.git'))) {
  console.error('This command must be run from the repository root.')
  process.exit(1)
}

if (!existsSync(hooksDir)) {
  console.error('Missing .githooks directory.')
  process.exit(1)
}

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: root,
  stdio: 'inherit',
})

for (const hook of ['pre-commit', 'commit-msg', 'pre-push']) {
  const path = join(hooksDir, hook)
  if (existsSync(path)) chmodSync(path, 0o755)
}

console.log('Git hooks installed with core.hooksPath=.githooks')
