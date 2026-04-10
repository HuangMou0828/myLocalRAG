import { execFileSync, spawnSync } from 'node:child_process'

const [, , command, ...rawArgs] = process.argv

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
    ...options,
  })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function read(bin, args) {
  return execFileSync(bin, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function git(args) {
  run('git', args)
}

function readGit(args) {
  return read('git', args)
}

function hasChanges() {
  return readGit(['status', '--porcelain']).length > 0
}

function hasStagedChanges() {
  try {
    execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: process.cwd() })
    return false
  }
  catch {
    return true
  }
}

function todayStamp() {
  const now = new Date()
  const yyyy = String(now.getFullYear())
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}

function slugify(input) {
  const slug = String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

  return slug || 'task'
}

function branchExists(branch) {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', branch], {
    cwd: process.cwd(),
    stdio: 'ignore',
  })
  return result.status === 0
}

function printUsage() {
  console.log(`Usage:
  npm run git:task:start -- "short task name"
  npm run git:task:commit -- "feat: concise change summary"
  npm run git:task:snapshot -- "optional WIP note"
  npm run git:task:finish

Rules:
  start     creates or switches to codex/YYYYMMDD-task-name
  commit    stages all non-ignored changes, runs typecheck, then commits
  snapshot  stages all non-ignored changes and makes a no-verify WIP commit
  finish    runs typecheck and build, then prints branch status`)
}

function startTask(args) {
  const taskName = args.join(' ').trim()
  if (!taskName) {
    console.error('Missing task name.')
    printUsage()
    process.exit(1)
  }

  const branch = `codex/${todayStamp()}-${slugify(taskName)}`
  const current = readGit(['branch', '--show-current'])

  if (current === branch) {
    console.log(`Already on ${branch}`)
    return
  }

  if (branchExists(branch)) {
    git(['switch', branch])
  }
  else {
    git(['switch', '-c', branch])
  }

  if (hasChanges()) {
    console.log('Working tree has changes. Commit or snapshot them before switching tasks.')
  }
}

function commitTask(args) {
  const skipCheck = args.includes('--no-check')
  const message = args.filter((arg) => arg !== '--no-check').join(' ').trim()

  if (!message) {
    console.error('Missing commit message.')
    printUsage()
    process.exit(1)
  }

  if (!skipCheck) {
    run('npm', ['run', 'typecheck'])
  }

  git(['add', '-A'])
  if (!hasStagedChanges()) {
    console.log('No staged changes to commit.')
    return
  }
  git(['commit', '-m', message])
}

function snapshotTask(args) {
  const note = args.join(' ').trim() || 'work in progress'
  git(['add', '-A'])
  if (!hasStagedChanges()) {
    console.log('No changes to snapshot.')
    return
  }
  git(['commit', '--no-verify', '-m', `chore(snapshot): ${note}`])
}

function finishTask() {
  run('npm', ['run', 'typecheck'])
  run('npm', ['run', 'build'])
  console.log('')
  console.log(`Branch: ${readGit(['branch', '--show-current'])}`)
  console.log('')
  run('git', ['status', '--short'])
  console.log('')
  run('git', ['log', '--oneline', '--decorate', '-8'])
}

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printUsage()
}
else if (command === 'start') {
  startTask(rawArgs)
}
else if (command === 'commit') {
  commitTask(rawArgs)
}
else if (command === 'snapshot') {
  snapshotTask(rawArgs)
}
else if (command === 'finish') {
  finishTask()
}
else {
  console.error(`Unknown command: ${command}`)
  printUsage()
  process.exit(1)
}
