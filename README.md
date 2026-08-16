# dsh-usage

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 网页端提供**常驻悬浮窗**、**可完全自定义的余额 / 用量面板**、**活跃热力图**与**双边用量对比**的 bundle 插件。

A persistent floating dock plus a fully customizable balance / token-usage panel, an activity heatmap, and a dual-channel comparison for the DeepSeek Harness Web GUI (`dsh web`).

## ✨ 功能速览 / Feature tour

> 🌊 **一眼余额，触手可及** — 左下角悬浮窗常显你关心的每一个数字；sidebar 收起时退化为一枚小巧的余额胶囊。
>
> 🎛️ **一切皆可自定义** — 每个功能都是独立卡片：拖动排序、置顶悬浮、折叠隐藏、主色 / 背景 / 透明度随心调。
>
> 🔥 **GitHub 式活跃热力图** — 近 28 天 × 6 时段的点块网格，一眼看出你的使用节律；再叠加 DSH 与 Claude Code 双通道的用量占比。

悬浮窗（Dock）· 数据一眼尽收：

```
┌────────────────────────────┐
│  余额            ¥128.00 🟢 │   ← 余额始终绿色，欠费才变红
│  今日用量          42.8M    │
├────────────────────────────┤
│  本月用量           1.4B    │
│  缓存命中          97.7%    │
└────────────────────────────┘
        ⚙ 齿轮开详情 · ↻ 一键刷新
```

详情面板（Panel）· 两列布局 + 拖拽排序：

```
┌──────────────────────────────┐
│  余额（全宽·左金额右明细）       │
├───────────────┬──────────────┤
│  今日用量      │  本月用量      │
├───────────────┼──────────────┤
│  缓存命中      │  通道比例      │
├───────────────┴──────────────┤
│  用量记录（全宽·按日下钻）       │
│  活跃热力图（28 天 × 6 时段）    │
└──────────────────────────────┘
   ▣ 拖拽任意卡片，虚线占位平滑让位
```

## 一眼看懂

| | 能力 | 说明 |
| --- | --- | --- |
| 💳 | 常驻悬浮窗 | 左下角 dock 常显 pinned 项（余额、今日、本月、缓存命中），行间分隔线、角落齿轮与刷新钮；sidebar 收起时退化为单个余额胶囊按钮，点击展开 |
| 🎨 | 一切皆可自定义 | 每个功能是独立 widget：pin、折叠、隐藏/恢复、**抓手拖拽排序**（虚线占位 + 平滑让位动画）、操作按钮悬停显现；主色调（预设+取色器）、背景色、面板不透明度均可调，设置持久化 localStorage |
| 📊 | 余额与用量面板 | 详情面板：账户卡片（供应商切换 + 余额明细）、今日/本月/累计 Token（k/M/B 紧凑单位）、缓存命中率、用量记录与按模型下钻 |
| 🔥 | 活跃热力图 | GitHub 风格点块：近 28 天 × 6 时段（每格 4 小时）+ 顶部日期标签，主色深浅表示使用频率 |
| ↔️ | 通道比例 | DSH 通道 vs Claude Code 通道（解析 `~/.claude/projects` JSONL 增量聚合）用量占比与分布 |
| 🔄 | 后台刷新 | 服务端启动即刷新，之后每 5 分钟更新余额、DSH Token 与 Claude Code 聚合 |
| 🔒 | 本机安全边界 | 三个端点仅接受回环 GET；凭据只在服务端解析；上游强制 HTTPS、拒绝私网解析并固定 DNS 连接；Claude 日志只聚合数字，对话文本永不落盘 |

界面支持中文和英文。凭据由 Harness 从 `~/.dsh/.credentials.yaml` 解析，插件不读取、不缓存、不回传任何密钥。

## 快速安装

需要 DeepSeek Harness `web` profile（`@deepseek-ai/dsh >= 0.1.0-rc.6`）。

本地目录开发安装（link 协议，改代码无需重装）：

```bash
dsh plugin --profile web add "E:/path/to/DSH-Usage"
```

远程安装（发布到 GitHub 后）：

```bash
dsh plugin --profile web add "github:<owner>/dsh-usage"
```

重启 `dsh web` 并在浏览器硬刷新，左下角出现常驻悬浮窗。更新 / 卸载：

```bash
dsh plugin --profile web update dsh-usage
dsh plugin --profile web remove dsh-usage
```

## 凭据配置

余额型供应商的凭据引用，全部写在 `~/.dsh/.credentials.yaml`：

```yaml
DEEPSEEK_API_KEY: sk-your-key-here            # DeepSeek 官方路由
OPENROUTER_MANAGEMENT_KEY: sk-or-v1-...       # OpenRouter 账户（需要 Management Key，不是推理 Key）
ZAI_API_KEY: your-zai-key                     # Z.ai 开放平台
```

Moonshot / Kimi 等 `llm-pi-ai` 中的 provider profile 会自动发现并复用其 `apiKeyEnv`。没有公开余额接口的供应商显示「无公开余额接口」，不会猜测。

## 支持的供应商

| Provider | 上游接口 | 默认凭据引用 |
| --- | --- | --- |
| DeepSeek | `GET {origin}/user/balance` | `DEEPSEEK_API_KEY` |
| OpenRouter | `GET {origin}/api/v1/credits` | `OPENROUTER_MANAGEMENT_KEY` |
| Moonshot / Kimi | `GET {origin}/v1/users/me/balance` | pi-ai provider `apiKeyEnv` |
| Z.ai / 智谱 | `GET {origin}/api/paas/v4/balance` | `ZAI_API_KEY` |

## API

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/api/usage/providers` | provider 列表、余额 scheme 与状态摘要 |
| `GET` | `/api/usage/balance?provider=<id>` | 统一余额快照；`refresh=1` 强制刷新上游 |
| `GET` | `/api/usage/usage` | 按日期/provider/model 聚合的 Token、缓存命中率、24 小时桶（`days[].hours`）与 Claude Code 通道（`claude`） |

非 GET 返回 `405`，非回环请求返回 `403`；所有响应均为 JSON 并带 `Cache-Control: no-cache`。

## 与 dsh-usage-stats 并存

本插件与 [dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats) 可同时安装：路由前缀（`/api/usage/` vs `/api/usage-stats/`）、缓存文件（`usage-cache.json` vs `usage-stats-cache.json`）、slot 注册 id（`usage` vs `usage-stats`）均不冲突。本插件的 Token 统计口径与 dsh-usage-stats 一致（provider-reported usage，同 turn/step 替换语义），迁移无痛。

## 开发与验证

```bash
npm install           # 仅 react/react-dom/jsdom 用于离线测试
npm run check         # 全量语法检查
npm test              # 81 个离线测试：余额 scheme、token 折叠、服务端边界、客户端、e2e 交互流、Claude 聚合
```

所有测试完全离线，不访问网络、不触碰真实 `~/.dsh`（服务端测试重定向 `DSH_HOME` 到临时目录）。真实 Claude 数据预演：`node scripts/validate-claude.mjs`。

## 隐私与安全

- API Key 永不进入浏览器响应、插件缓存或日志；凭据由 Harness credentials seam 在请求时解析。
- 上游余额查询：强制 HTTPS、预解析 DNS 并拒绝回环/私网/链路本地/组播等非公网地址、连接固定到校验过的地址（防 DNS rebinding）、响应上限 1 MiB、超时 15 秒。
- 用量缓存 `~/.dsh/storages/usage-cache.json` 只保存聚合 Token 与会话折叠游标，不保存提示词或回复内容。
- 请勿将本插件端点经反向代理暴露到局域网或公网。

## 致谢 / Credits

- [Ychris12138/dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats)（MIT）：余额 scheme 与 Token 折叠语义、DSH bundle 插件结构与安全边界的参考实现。

## License

[MIT](LICENSE)
