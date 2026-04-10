function normalizeText(input) {
  return String(input || '').trim()
}

function sanitizeSecret(input) {
  return normalizeText(input)
}

function maskSecret(secret) {
  const value = sanitizeSecret(secret)
  if (!value) return ''
  if (value.length <= 8) return `${value.slice(0, 2)}***`
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}

function buildEnvDefaults() {
  return {
    mcpUrl: normalizeText(process.env.FEISHU_PROJECT_MCP_URL) || 'https://project.feishu.cn/mcp_server/v1',
    token: sanitizeSecret(process.env.FEISHU_PROJECT_MCP_TOKEN),
    projectKey: normalizeText(process.env.FEISHU_PROJECT_KEY) || '63f06ba317c6ab1823e64ce4',
  }
}

function normalizeStoredSettings(input = {}) {
  const base = input && typeof input === 'object' ? input : {}
  return {
    mode: base.mode === 'custom' ? 'custom' : 'default',
    customToken: sanitizeSecret(base.customToken),
    customProjectKey: normalizeText(base.customProjectKey),
  }
}

export function mergeFeishuProjectSettings(previous = {}, incoming = {}) {
  const prev = normalizeStoredSettings(previous)
  const next = incoming && typeof incoming === 'object' ? incoming : {}
  const mode = next.mode === 'custom' ? 'custom' : 'default'
  const hasCustomConfig = next.customConfig && typeof next.customConfig === 'object'
  const hasCustomToken = Object.prototype.hasOwnProperty.call(next, 'customToken')
    || (hasCustomConfig && Object.prototype.hasOwnProperty.call(next.customConfig, 'token'))
  const hasCustomProjectKey = Object.prototype.hasOwnProperty.call(next, 'customProjectKey')
    || (hasCustomConfig && Object.prototype.hasOwnProperty.call(next.customConfig, 'projectKey'))
  const customTokenInput = sanitizeSecret(next?.customConfig?.token ?? next.customToken)
  const customProjectKeyInput = normalizeText(next?.customConfig?.projectKey ?? next.customProjectKey)

  return {
    mode,
    customToken: hasCustomToken ? (customTokenInput || prev.customToken) : prev.customToken,
    customProjectKey: hasCustomProjectKey ? customProjectKeyInput : prev.customProjectKey,
  }
}

export function buildEffectiveFeishuProjectSettings(stored = {}) {
  const envDefaults = buildEnvDefaults()
  const saved = normalizeStoredSettings(stored)
  const canUseCustom = Boolean(saved.customToken)
  const activeMode = saved.mode === 'custom' && canUseCustom ? 'custom' : 'default'
  const effectiveToken = activeMode === 'custom' ? saved.customToken : envDefaults.token
  const effectiveProjectKey = activeMode === 'custom'
    ? (saved.customProjectKey || envDefaults.projectKey)
    : envDefaults.projectKey

  return {
    savedMode: saved.mode,
    activeMode,
    defaultConfig: {
      mcpUrl: envDefaults.mcpUrl,
      projectKey: envDefaults.projectKey,
      token: envDefaults.token,
    },
    customConfig: {
      token: saved.customToken,
      projectKey: saved.customProjectKey,
    },
    effective: {
      mcpUrl: envDefaults.mcpUrl,
      token: effectiveToken,
      projectKey: effectiveProjectKey,
    },
  }
}

export function buildFeishuProjectSettingsView(stored = {}) {
  const resolved = buildEffectiveFeishuProjectSettings(stored)

  return {
    mode: resolved.savedMode,
    modeResolved: resolved.activeMode,
    defaultConfig: {
      mcpUrl: resolved.defaultConfig.mcpUrl,
      projectKey: resolved.defaultConfig.projectKey,
      tokenMasked: maskSecret(resolved.defaultConfig.token),
      tokenAvailable: Boolean(resolved.defaultConfig.token),
    },
    customConfig: {
      token: '',
      tokenMasked: maskSecret(resolved.customConfig.token),
      tokenAvailable: Boolean(resolved.customConfig.token),
      projectKey: resolved.customConfig.projectKey,
    },
    effectiveConfig: {
      mode: resolved.activeMode,
      mcpUrl: resolved.effective.mcpUrl,
      projectKey: resolved.effective.projectKey,
      tokenMasked: maskSecret(resolved.effective.token),
      tokenAvailable: Boolean(resolved.effective.token),
    },
  }
}
