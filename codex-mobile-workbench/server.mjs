import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const HOST = args.host || process.env.HOST || '127.0.0.1';
const PORT = Number(args.port || process.env.PORT || 8787);
const CODEX_BIN = process.env.CODEX_BIN || '/Applications/Codex.app/Contents/Resources/codex';
const DEFAULT_WORKSPACE = process.env.WORKBENCH_DEFAULT_WORKSPACE || '/Users/hm/myLocalRAG';
const WORKSPACES = parseWorkspaces(process.env.WORKBENCH_WORKSPACES || DEFAULT_WORKSPACE);
const PUBLIC_DIR = resolve(import.meta.dirname, 'public');
const DATA_DIR = resolve(import.meta.dirname, 'data');
const STATE_FILE = resolve(DATA_DIR, 'state.json');
const TOKEN_FILE = resolve(DATA_DIR, 'token');
const MAX_TASKS = 60;
const MAX_MESSAGES = 120;
const TASK_TIMEOUT_MS = Number(process.env.WORKBENCH_TASK_TIMEOUT_MS || 10 * 60 * 1000);
const AUTH_TOKEN = process.env.WORKBENCH_TOKEN || await loadOrCreateToken();

const clients = new Set();
const runningTasks = new Map();
let saveTimer = null;
let tasks = [];
let messages = [];

await loadStateFromDisk();

if (messages.length === 0) {
  messages = [
    assistantMessage('手机工作台已就绪。可以先试试“查看状态”，需要动代码的任务会先等你批准。'),
  ];
  scheduleSave();
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      if (!isAuthorized(req, url)) {
        return sendJson(res, 401, { error: 'unauthorized' });
      }
      return handleApi(req, res, url);
    }

    return serveStatic(req, res, url);
  }
  catch (error) {
    console.error(error);
    const status = Number(error?.statusCode || 500);
    sendJson(res, status, {
      error: status === 500 ? 'internal_error' : 'request_error',
      detail: String(error?.message || error),
    });
  }
});

server.listen(PORT, HOST, () => {
  const local = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/?token=${AUTH_TOKEN}`;
  console.log('');
  console.log('Codex Mobile Workbench is running.');
  console.log(`Local: ${local}`);

  if (HOST === '0.0.0.0') {
    for (const ip of getLanIps()) {
      console.log(`LAN:   http://${ip}:${PORT}/?token=${AUTH_TOKEN}`);
    }
  }

  console.log('');
  console.log('Keep this token private. Use Tailscale or a trusted LAN for phone access.');
});

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    return sendJson(res, 200, {
      workspaces: WORKSPACES,
      defaultWorkspace: DEFAULT_WORKSPACE,
      codexAvailable: existsSync(CODEX_BIN),
      host: HOST,
      port: PORT,
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, {
      messages,
      tasks: tasks.slice(-MAX_TASKS),
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/message') {
    const body = await readBody(req);
    const workspace = resolveWorkspace(body.workspace);
    const text = String(body.text || '').trim();

    if (!text) {
      return sendJson(res, 400, { error: 'message_required' });
    }

    addMessage(userMessage(text));
    const task = createTaskFromText(text, workspace);
    addTask(task);

    if (task.requiresApproval) {
      addMessage(assistantMessage(`我准备执行“${task.title}”。风险级别：${task.risk}。请在手机上批准或拒绝。`, task.id));
    }
    else {
      addMessage(assistantMessage(`开始执行“${task.title}”。`, task.id));
      runTask(task.id);
    }

    return sendJson(res, 200, { task });
  }

  const approveMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/approve$/);
  if (req.method === 'POST' && approveMatch) {
    const task = findTask(approveMatch[1]);
    if (!task) return sendJson(res, 404, { error: 'task_not_found' });
    if (task.status !== 'pending_approval') return sendJson(res, 409, { error: 'task_not_pending' });
    addMessage(userMessage(`批准执行：${task.title}`));
    runTask(task.id);
    return sendJson(res, 200, { task });
  }

  const rejectMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/reject$/);
  if (req.method === 'POST' && rejectMatch) {
    const task = findTask(rejectMatch[1]);
    if (!task) return sendJson(res, 404, { error: 'task_not_found' });
    if (task.status !== 'pending_approval') return sendJson(res, 409, { error: 'task_not_pending' });

    task.status = 'rejected';
    task.endedAt = new Date().toISOString();
    task.logs.push(logLine('system', 'User rejected the task.'));
    publishTaskUpdate(task);
    addMessage(userMessage(`拒绝执行：${task.title}`));
    addMessage(assistantMessage(`已取消“${task.title}”。`, task.id));
    return sendJson(res, 200, { task });
  }

  const cancelMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && cancelMatch) {
    const task = findTask(cancelMatch[1]);
    if (!task) return sendJson(res, 404, { error: 'task_not_found' });
    if (task.status !== 'running') return sendJson(res, 409, { error: 'task_not_running' });

    const running = runningTasks.get(task.id);
    if (!running) return sendJson(res, 409, { error: 'task_process_not_found' });

    task.cancelled = true;
    task.logs.push(logLine('system', 'Cancel requested by user.'));
    publishTaskUpdate(task);
    addMessage(userMessage(`取消执行：${task.title}`));
    running.child.kill('SIGTERM');
    running.forceKillTimer = setTimeout(() => running.child.kill('SIGKILL'), 3000);
    return sendJson(res, 200, { task });
  }

  return sendJson(res, 404, { error: 'not_found' });
}

function createTaskFromText(text, workspace) {
  const normalized = text.toLowerCase();

  if (matchesAny(normalized, ['status', '状态', '未提交', 'git 状态', 'git status'])) {
    return createTask({
      title: '查看 Git 状态',
      risk: 'low',
      requiresApproval: false,
      workspace,
      commandLabel: 'git status --short --branch',
      command: 'git',
      args: ['status', '--short', '--branch'],
    });
  }

  if (matchesAny(normalized, ['diff', '改动', '变更', '总结改动'])) {
    return createTask({
      title: '查看改动摘要',
      risk: 'low',
      requiresApproval: false,
      workspace,
      commandLabel: 'git diff --stat',
      command: 'git',
      args: ['diff', '--stat'],
    });
  }

  if (matchesAny(normalized, ['typecheck', '类型检查', 'tsc'])) {
    return createTask({
      title: '运行 typecheck',
      risk: 'medium',
      requiresApproval: true,
      workspace,
      commandLabel: 'npm run typecheck',
      command: 'npm',
      args: ['run', 'typecheck'],
    });
  }

  if (matchesAny(normalized, ['build', '构建', '打包'])) {
    return createTask({
      title: '运行 build',
      risk: 'medium',
      requiresApproval: true,
      workspace,
      commandLabel: 'npm run build',
      command: 'npm',
      args: ['run', 'build'],
    });
  }

  return createTask({
    title: '让 Codex 处理任务',
    risk: 'high',
    requiresApproval: true,
    workspace,
    prompt: text,
    commandLabel: 'codex exec --full-auto',
    command: CODEX_BIN,
    args: ['exec', '--json', '--full-auto', '-C', workspace, text],
  });
}

function createTask(input) {
  return {
    id: randomUUID(),
    title: input.title,
    risk: input.risk,
    requiresApproval: input.requiresApproval,
    status: input.requiresApproval ? 'pending_approval' : 'queued',
    workspace: input.workspace,
    commandLabel: input.commandLabel,
    command: input.command,
    args: input.args,
    prompt: input.prompt || null,
    logs: [],
    agentMessages: [],
    codex: {
      threadId: null,
      usage: null,
    },
    cancelled: false,
    timedOut: false,
    exitCode: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
  };
}

function runTask(taskId) {
  const task = findTask(taskId);
  if (!task || task.status === 'running') return;

  task.status = 'running';
  task.startedAt = new Date().toISOString();
  task.logs.push(logLine('system', `Running in ${task.workspace}`));
  task.logs.push(logLine('system', `$ ${task.commandLabel}`));
  publishTaskUpdate(task);

  const child = spawn(task.command, task.args, {
    cwd: task.workspace,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const timeout = setTimeout(() => {
    task.timedOut = true;
    task.logs.push(logLine('system', `Task timed out after ${Math.round(TASK_TIMEOUT_MS / 1000)} seconds.`));
    publishTaskUpdate(task);
    child.kill('SIGTERM');
  }, TASK_TIMEOUT_MS);

  runningTasks.set(task.id, { child, timeout, forceKillTimer: null });

  child.stdout.on('data', (chunk) => appendTaskOutput(task, 'stdout', chunk));
  child.stderr.on('data', (chunk) => appendTaskOutput(task, 'stderr', chunk));

  child.on('error', (error) => {
    task.status = 'failed';
    task.endedAt = new Date().toISOString();
    task.logs.push(logLine('stderr', String(error?.message || error)));
    publishTaskUpdate(task);
    addMessage(assistantMessage(`“${task.title}”启动失败：${error?.message || error}`, task.id));
  });

  child.on('close', (code) => {
    const running = runningTasks.get(task.id);
    if (running) {
      clearTimeout(running.timeout);
      clearTimeout(running.forceKillTimer);
      runningTasks.delete(task.id);
    }

    task.exitCode = code;
    task.status = task.cancelled ? 'cancelled' : task.timedOut ? 'timed_out' : code === 0 ? 'completed' : 'failed';
    task.endedAt = new Date().toISOString();
    task.logs.push(logLine('system', `Exit code: ${code}`));
    publishTaskUpdate(task);

    const result = task.status === 'cancelled' ? '已取消' : task.status === 'timed_out' ? '超时停止' : code === 0 ? '完成' : '失败';
    const suffix = task.agentMessages.length > 0 && code === 0 ? usageSummary(task) : summarizeTail(task.logs);
    addMessage(assistantMessage(`“${task.title}”${result}。${suffix}`, task.id));
  });
}

function appendTaskOutput(task, stream, chunk) {
  const text = stripAnsi(String(chunk));
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (stream === 'stdout' && handleCodexJsonLine(task, line)) continue;
    if (isNoisyCodexWarning(line)) continue;
    task.logs.push(logLine(stream, line));
  }
  task.logs = task.logs.slice(-500);
  publishTaskUpdate(task);
}

function handleCodexJsonLine(task, line) {
  let event = null;
  try {
    event = JSON.parse(line);
  }
  catch {
    return false;
  }

  if (!event || typeof event !== 'object' || !event.type) {
    return false;
  }

  if (event.type === 'thread.started') {
    task.codex.threadId = event.thread_id || null;
    task.logs.push(logLine('event', `Codex thread: ${task.codex.threadId || 'unknown'}`));
    return true;
  }

  if (event.type === 'turn.started') {
    task.logs.push(logLine('event', 'Codex turn started'));
    return true;
  }

  if (event.type === 'item.completed') {
    const item = event.item || {};
    if (item.type === 'agent_message' && item.text) {
      const text = String(item.text);
      task.agentMessages.push(text);
      task.logs.push(logLine('agent', text));
      addMessage(assistantMessage(text, task.id));
      return true;
    }

    task.logs.push(logLine('event', `Codex item completed: ${item.type || 'unknown'}`));
    return true;
  }

  if (event.type === 'turn.completed') {
    task.codex.usage = event.usage || null;
    task.logs.push(logLine('event', usageSummary(task)));
    return true;
  }

  if (event.type === 'error') {
    task.logs.push(logLine('stderr', event.message || 'Codex error'));
    return true;
  }

  task.logs.push(logLine('event', `Codex event: ${event.type}`));
  return true;
}

function usageSummary(task) {
  const usage = task.codex?.usage;
  if (!usage) return '已收到 Codex 回复。';

  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  if (!input && !output) return '已收到 Codex 回复。';
  return `Token：输入 ${input}，输出 ${output}。`;
}

function isNoisyCodexWarning(line) {
  return line.includes('ignoring interface.defaultPrompt: prompt must be at most 128 characters')
    || line.includes('Failed to delete shell snapshot')
    || line === 'Reading additional input from stdin...';
}

function summarizeTail(logs) {
  const visible = logs
    .filter((entry) => entry.stream !== 'system')
    .slice(-4)
    .map((entry) => entry.text)
    .join(' / ');

  if (!visible) return '没有额外输出。';
  return `最近输出：${visible}`;
}

function addTask(task) {
  tasks.push(task);
  while (tasks.length > MAX_TASKS) tasks.shift();
  broadcast('task:add', task);
  scheduleSave();
}

function addMessage(message) {
  messages.push(message);
  while (messages.length > MAX_MESSAGES) messages.shift();
  broadcast('message:add', message);
  scheduleSave();
}

function publishTaskUpdate(task) {
  broadcast('task:update', task);
  scheduleSave();
}

function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    text,
    createdAt: new Date().toISOString(),
  };
}

function assistantMessage(text, taskId = null) {
  return {
    id: randomUUID(),
    role: 'assistant',
    text,
    taskId,
    createdAt: new Date().toISOString(),
  };
}

function logLine(stream, text) {
  return {
    id: randomUUID(),
    stream,
    text,
    createdAt: new Date().toISOString(),
  };
}

function findTask(id) {
  return tasks.find((task) => task.id === id);
}

async function loadStateFromDisk() {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    messages = Array.isArray(data.messages) ? data.messages.slice(-MAX_MESSAGES) : [];
    tasks = Array.isArray(data.tasks) ? data.tasks.slice(-MAX_TASKS).map(normalizeTask) : [];
  }
  catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`Could not load state file: ${error?.message || error}`);
    }
  }
}

async function loadOrCreateToken() {
  try {
    const token = (await readFile(TOKEN_FILE, 'utf8')).trim();
    if (token) return token;
  }
  catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`Could not load token file: ${error?.message || error}`);
    }
  }

  const token = randomBytes(18).toString('base64url');
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
  return token;
}

function normalizeTask(task) {
  const normalized = {
    ...task,
    logs: Array.isArray(task.logs) ? task.logs : [],
    agentMessages: Array.isArray(task.agentMessages) ? task.agentMessages : [],
    codex: {
      threadId: task.codex?.threadId || null,
      usage: task.codex?.usage || null,
    },
    cancelled: Boolean(task.cancelled),
    timedOut: Boolean(task.timedOut),
  };

  if (normalized.status === 'running' || normalized.status === 'queued') {
    normalized.status = 'failed';
    normalized.endedAt = normalized.endedAt || new Date().toISOString();
    normalized.logs.push(logLine('system', 'Server restarted before this task finished.'));
  }

  return normalized;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveStateToDisk().catch((error) => {
      console.warn(`Could not save state file: ${error?.message || error}`);
    });
  }, 150);
}

async function saveStateToDisk() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    messages,
    tasks,
  }, null, 2));
}

function resolveWorkspace(input) {
  const candidate = resolve(String(input || DEFAULT_WORKSPACE));
  const allowed = WORKSPACES.find((workspace) => workspace === candidate);
  if (!allowed) {
    throw Object.assign(new Error(`Workspace is not allowed: ${candidate}`), { statusCode: 403 });
  }
  return allowed;
}

function parseWorkspaces(value) {
  return value
    .split(',')
    .map((item) => resolve(item.trim()))
    .filter(Boolean);
}

function matchesAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function isAuthorized(req, url) {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const queryToken = url.searchParams.get('token');
  return bearer === AUTH_TOKEN || queryToken === AUTH_TOKEN;
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const filePath = resolve(PUBLIC_DIR, `.${pathname}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mimeType(filePath),
      'Cache-Control': 'no-store',
    });
    res.end(data);
  }
  catch {
    sendText(res, 404, 'Not found');
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function broadcast(type, payload) {
  const event = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) client.write(event);
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 64) {
        rejectBody(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolveBody(data ? JSON.parse(data) : {});
      }
      catch {
        rejectBody(new Error('Invalid JSON'));
      }
    });
    req.on('error', rejectBody);
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--host') parsed.host = argv[++index];
    if (arg === '--port') parsed.port = argv[++index];
  }
  return parsed;
}

function getLanIps() {
  const ips = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        ips.push(address.address);
      }
    }
  }
  return ips;
}

function mimeType(pathname) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  return types[extname(pathname)] || 'application/octet-stream';
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}
