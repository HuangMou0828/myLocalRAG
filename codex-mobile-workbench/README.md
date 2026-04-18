# Codex Mobile Workbench

手机优先的本地工作台 MVP，用来从手机给 Mac 发任务、审批执行、查看实时日志。

## 运行

本机调试：

```bash
npm start
```

让局域网或 Tailscale 设备访问：

```bash
npm run dev
```

启动后终端会打印带 `token` 的访问地址。手机必须使用这个完整地址。

## 当前能力

- 查看 Git 状态：无需审批
- 查看改动摘要：无需审批
- 运行 `npm run typecheck`：需要审批
- 运行 `npm run build`：需要审批
- 其他自然语言任务：需要审批后执行 Codex 桌面 App 自带 CLI 的 `codex exec --full-auto`
- Codex JSONL 输出会被整理成手机端可读的聊天回复
- 会话、任务和日志会保存到本地 `data/state.json`，服务重启后仍可查看
- 运行中的任务可以在手机上取消
- 默认单个任务 10 分钟超时，可通过 `WORKBENCH_TASK_TIMEOUT_MS` 调整

## 环境变量

```bash
PORT=8787
HOST=0.0.0.0
WORKBENCH_TOKEN=change-me
WORKBENCH_DEFAULT_WORKSPACE=/Users/hm/myLocalRAG
WORKBENCH_WORKSPACES=/Users/hm/myLocalRAG,/Users/hm/other-project
CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex
WORKBENCH_TASK_TIMEOUT_MS=600000
```

## 安全边界

第一版只允许访问 `WORKBENCH_WORKSPACES` 里的目录。中高风险操作必须在手机页面点击批准后才会执行。

不要把服务直接暴露到公网。推荐使用 Tailscale、ZeroTier 或可信局域网。

## 手机和电脑同步

手机页面、电脑浏览器页面看到的是同一个工作台状态。打开同一个带 `token` 的 URL 即可看到同一批消息和任务。

Codex 桌面 App 不会自动显示这里的聊天记录；这里通过 `codex exec` 创建的是一次性 Codex CLI 任务。
