const token = new URLSearchParams(window.location.search).get('token') || localStorage.getItem('workbenchToken') || '';
if (token) localStorage.setItem('workbenchToken', token);

const state = {
  messages: [],
  tasks: [],
  config: null,
};

const elements = {
  connection: document.querySelector('#connection'),
  workspace: document.querySelector('#workspace'),
  messages: document.querySelector('#messages'),
  tasks: document.querySelector('#tasks'),
  composer: document.querySelector('#composer'),
  prompt: document.querySelector('#prompt'),
  refresh: document.querySelector('#refresh'),
};

boot();

async function boot() {
  bindEvents();

  if (!token) {
    setConnection('缺少 token', 'offline');
    renderMessage({
      role: 'assistant',
      text: '地址里缺少 token。请使用服务启动时打印的完整链接。',
      createdAt: new Date().toISOString(),
    });
    return;
  }

  await loadConfig();
  await loadState();
  connectEvents();
}

function bindEvents() {
  elements.composer.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = elements.prompt.value.trim();
    if (!text) return;
    elements.prompt.value = '';
    await sendMessage(text);
  });

  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.addEventListener('click', () => sendMessage(button.dataset.prompt));
  });

  elements.refresh.addEventListener('click', loadState);
}

async function loadConfig() {
  state.config = await api('/api/config');
  elements.workspace.innerHTML = '';

  for (const workspace of state.config.workspaces) {
    const option = document.createElement('option');
    option.value = workspace;
    option.textContent = workspace;
    if (workspace === state.config.defaultWorkspace) option.selected = true;
    elements.workspace.append(option);
  }
}

async function loadState() {
  const snapshot = await api('/api/state');
  state.messages = snapshot.messages || [];
  state.tasks = snapshot.tasks || [];
  render();
}

function connectEvents() {
  const events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  events.addEventListener('open', () => setConnection('在线', 'online'));
  events.addEventListener('error', () => setConnection('重连中', 'offline'));

  events.addEventListener('message:add', (event) => {
    state.messages.push(JSON.parse(event.data));
    state.messages = state.messages.slice(-100);
    renderMessages();
  });

  events.addEventListener('task:add', (event) => {
    upsertTask(JSON.parse(event.data));
    renderTasks();
  });

  events.addEventListener('task:update', (event) => {
    upsertTask(JSON.parse(event.data));
    renderTasks();
  });
}

async function sendMessage(text) {
  await api('/api/message', {
    method: 'POST',
    body: {
      text,
      workspace: elements.workspace.value,
    },
  });
}

async function approveTask(taskId) {
  await api(`/api/tasks/${taskId}/approve`, { method: 'POST' });
}

async function rejectTask(taskId) {
  await api(`/api/tasks/${taskId}/reject`, { method: 'POST' });
}

async function cancelTask(taskId) {
  await api(`/api/tasks/${taskId}/cancel`, { method: 'POST' });
}

function upsertTask(task) {
  const index = state.tasks.findIndex((item) => item.id === task.id);
  if (index === -1) state.tasks.push(task);
  else state.tasks[index] = task;
  state.tasks = state.tasks.slice(-60);
}

function render() {
  renderMessages();
  renderTasks();
}

function renderMessages() {
  elements.messages.innerHTML = '';
  for (const message of state.messages) {
    renderMessage(message);
  }
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function renderMessage(message) {
  const item = document.createElement('article');
  item.className = `message ${message.role || 'assistant'}`;
  item.textContent = message.text;

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = formatTime(message.createdAt);
  item.append(time);

  elements.messages.append(item);
}

function renderTasks() {
  elements.tasks.innerHTML = '';

  const tasks = [...state.tasks].reverse();
  if (tasks.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'message assistant';
    empty.textContent = '还没有任务。';
    elements.tasks.append(empty);
    return;
  }

  for (const task of tasks) {
    elements.tasks.append(taskElement(task));
  }
}

function taskElement(task) {
  const root = document.createElement('article');
  root.className = 'task';

  const main = document.createElement('div');
  main.className = 'task-main';

  const heading = document.createElement('div');
  heading.className = 'task-heading';

  const title = document.createElement('p');
  title.className = 'task-title';
  title.textContent = task.title;

  const status = document.createElement('span');
  status.className = `badge ${task.status}`;
  status.textContent = statusText(task.status);

  heading.append(title, status);

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  meta.append(
    badge(`风险：${riskText(task.risk)}`),
    badge(task.commandLabel),
    badge(formatTime(task.createdAt)),
  );

  main.append(heading, meta);

  if (task.status === 'pending_approval') {
    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const approve = document.createElement('button');
    approve.textContent = '批准';
    approve.addEventListener('click', () => approveTask(task.id));

    const reject = document.createElement('button');
    reject.textContent = '拒绝';
    reject.className = 'danger';
    reject.addEventListener('click', () => rejectTask(task.id));

    actions.append(approve, reject);
    main.append(actions);
  }

  if (task.status === 'running') {
    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const cancel = document.createElement('button');
    cancel.textContent = '取消任务';
    cancel.className = 'danger';
    cancel.addEventListener('click', () => cancelTask(task.id));

    actions.append(cancel);
    main.append(actions);
  }

  root.append(main);

  if (task.logs?.length) {
    const logs = document.createElement('div');
    logs.className = 'logs';
    for (const line of task.logs.slice(-120)) {
      const item = document.createElement('div');
      item.className = `log ${line.stream}`;
      item.textContent = `[${line.stream}] ${line.text}`;
      logs.append(item);
    }
    root.append(logs);
  }

  return root;
}

function badge(text) {
  const item = document.createElement('span');
  item.className = 'badge';
  item.textContent = text;
  return item;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || response.statusText);
  }

  return response.json();
}

function setConnection(text, mode) {
  elements.connection.textContent = text;
  elements.connection.className = `status-pill ${mode}`;
}

function statusText(status) {
  const map = {
    queued: '排队',
    pending_approval: '待批准',
    running: '执行中',
    completed: '完成',
    failed: '失败',
    rejected: '已拒绝',
    cancelled: '已取消',
    timed_out: '已超时',
  };
  return map[status] || status;
}

function riskText(risk) {
  const map = {
    low: '低',
    medium: '中',
    high: '高',
  };
  return map[risk] || risk;
}

function formatTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}
