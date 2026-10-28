# 🌊 dsh-usage v0.4.0 · 宿主兼容与精确小计

## 修复

- **0.1.x 宿主不再 500。** 实时会话按宿主实际提供的 Session API 探测读取：`events`（0.1.4 及更早）→ `snapshotEvents()` / `snapshotEvents(0, seq+1)`（0.1.5）→ `ownEvents()`（fork）。认不出的契约只把该会话计入「未计入」，不会让整条 `/api/usage/usage` 返回 HTTP 500，也不会被当成零用量。
- **持久化日志兼容。** 0.2 走 `open(id,'read')` 只读句柄；0.1.x 走 `readFrom`。宿主两者都没有时，该会话标记为 skipped（`unsupported-host`），接口仍返回 200 与覆盖度。
- 会话列表整体读取失败仍视为错误（不会被伪装成空统计）。

## 改进

- **精确可读小计。** 部分统计不再给数值加「≥」前缀：今日 / 本月 / 当日条目直接显示可确认的精确小计；面板底部保留可展开的覆盖度告警（含每个被跳过会话的原因）。「全部不可读」时仍显示「—」，不冒充零。
- coverage 的 `skippedSessions[].reason` 增加 `unsupported-session-api` 与 `unsupported-host` 两种取值，便于定位宿主差异。

## 测试

- 新增 `scripts/test-compat.mjs`（5 项）：0.1.x events 数组、0.1.5 snapshotEvents、ownEvents、无 reader 宿主、抛错会话。
- 全量离线回归 **117 项全绿**（余额 11 / 用量 15 / 服务端 22 / 客户端 8 / e2e 20 / Claude 13 / 发布 1 / 0.2 契约 22 / 宿主兼容 5）。

## 升级与边界

- **网页端**：`dsh plugin --profile web update dsh-usage`，然后**由你手动**重启 `dsh web` 并硬刷新。服务端改动必须重启才生效。
- **桌面端**：先保存任务、完整退出应用，用桌面自带 CLI 以 `desktop` profile 安装/更新，再手动重新打开。
- **未做 0.1.x 真机验收。** 本版兼容层以宿主 API 形状的合成契约测试覆盖；请 0.1.x 用户在升级后复测并反馈。0.2.0-rc.2 网页端与 Windows 桌面端为已验证环境，Windows 之外的桌面平台未做真机验收。
- 旧格式（0.1 时代 zstd 压缩）会话仍受宿主 `SessionFormatUnsupportedError` 限制，不会被解压或改写；它们只会出现在覆盖度告警中，不参与可读小计。

## 安装

```bash
# 网页端
dsh plugin --profile web add "github:Aisland-SJL/dsh-usage"

# 固定名发布包（发布后）
dsh plugin --profile web add "https://github.com/Aisland-SJL/dsh-usage/releases/latest/download/dsh-usage.tgz"
```

## 验证范围

截至 2026-10-29，本地全量离线回归 117 项通过；本版的服务端改动尚未在重启后的 0.2 宿主上做真实端点复验（等待用户重启后即可验证）。0.1.x 环境未在本机运行。
