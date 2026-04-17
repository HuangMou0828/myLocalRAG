# OpenClaw Sync Launchd 运维说明

更新时间：2026-04-17

## 1. 任务概览

- Label：`ai.openclaw.sync-import`
- plist：`/Users/hm/Library/LaunchAgents/ai.openclaw.sync-import.plist`
- 执行脚本：`/Users/hm/.openclaw/scripts/sync-import-launchd.sh`
- 日志：
  - stdout：`/Users/hm/.openclaw/logs/sync-import.launchd.out.log`
  - stderr：`/Users/hm/.openclaw/logs/sync-import.launchd.err.log`

## 2. 行为与作用

这个任务负责每天把 OpenClaw 数据同步进 inbox，并触发 import：

1. 先执行 `sync-v3.py`，将 `.learnings` 与 `memory` 的内容同步到 `~/.openclaw/knowledge/inbox/*`。
2. 再调用 `POST /api/openclaw-knowledge/import` 导入到系统知识入口。
3. 对 import 结果做校验：
   - HTTP 状态必须是 `200`
   - JSON 的 `ok` 必须为 `true`
   - `summary.failed` 必须为 `0`

## 3. 调度规则

- 调度方式：`launchd`（LaunchAgent）
- 触发时间：每天 `09:30`（本地时区）
- `RunAtLoad`：`false`
  - 意味着：任务在被 `bootstrap`/重载时不会自动立即执行。
  - 只会按计划时间执行，或被手动触发。

## 4. 可靠性规则

当前脚本内置了以下保护：

1. 互斥锁：`/tmp/openclaw-sync-import.lock`
2. 锁自愈：
   - 如果 lock 中记录的 pid 已死亡，会自动回收陈旧锁并继续。
   - 如果 lock 无 pid 且超过陈旧阈值，也会尝试回收。
3. 超时控制：`sync-v3.py` 超时会终止并返回非 0。
4. import 容错：curl 重试、连接超时、总超时，并保留失败摘要日志。

## 5. 手动触发方式

### 5.1 直接执行脚本（最直观）

```bash
/usr/bin/time -p /Users/hm/.openclaw/scripts/sync-import-launchd.sh
```

### 5.2 通过 launchd 触发（等价于定时任务环境）

```bash
uid=$(id -u)
launchctl kickstart -k gui/$uid/ai.openclaw.sync-import
```

## 6. 常用检查命令

### 6.1 查看任务状态

```bash
uid=$(id -u)
launchctl print gui/$uid/ai.openclaw.sync-import | rg 'state =|runs =|last exit code'
```

### 6.2 查看最近日志

```bash
tail -n 40 /Users/hm/.openclaw/logs/sync-import.launchd.out.log
tail -n 40 /Users/hm/.openclaw/logs/sync-import.launchd.err.log
```

### 6.3 重载配置（修改 plist 后）

```bash
uid=$(id -u)
launchctl bootout gui/$uid /Users/hm/Library/LaunchAgents/ai.openclaw.sync-import.plist >/dev/null 2>&1 || true
launchctl bootstrap gui/$uid /Users/hm/Library/LaunchAgents/ai.openclaw.sync-import.plist
launchctl enable gui/$uid/ai.openclaw.sync-import
```

## 7. 与 OpenClaw cron 的关系

当前只有 launchd 在跑，OpenClaw cron `mylocalrag-openclaw-inbox-import` 已禁用（2026-04-17）：

- `09:30`：`launchd` 执行主同步（生产 + 导入）← 主要链路
- `18:00`：（已禁用）如需恢复，将 job `1b1c4471-7826-4c8f-aaef-c7a42a85748a` 的 `enabled` 改为 `true` 即可

## 8. 维护记录

### 2026-04-17 14:01
- 变更：更新第 7 节，标注 `mylocalrag-openclaw-inbox-import` 已禁用
- 原因：主链路已切换至 launchd，不需要双重消费
- 影响范围：无，日常巡检不受影响
- 验证结果：文档已同步更新
- 回滚方式：启用 cron job `1b1c4471` 即可

