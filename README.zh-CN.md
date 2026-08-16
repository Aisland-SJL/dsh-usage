# 🌊 dsh-usage

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 网页端（`dsh web`）提供**常驻悬浮窗**、**完全可自定义的余额 / 用量面板**、**活跃热力图**与**双边通道用量对比**的 bundle 插件。

[English](README.md) · [MIT](LICENSE)

## ✨ 功能速览

### 🌊 常驻悬浮窗

你关心的数字始终可见——余额常绿（欠费才变红），行间细线分隔，右上角 ⚙ 打开详情、↻ 一键刷新；sidebar 收起时自动折叠成一枚小巧的余额胶囊。

<table><tr>
<td width="44%"><img src="docs/images/dock.png" alt="dsh-usage 悬浮窗" width="100%"></td>
<td>

- 🟢 **余额** — 健康时绿色，欠费时红色
- 📊 **今日 / 本月 / 缓存命中** — 一眼尽收的用量数字
- ⚙ **齿轮开详情** · ↻ 一键刷新
- 🧲 **与 pin 设置同步** — 每次调整立即生效

</td>
</tr></table>

### 🎛️ 详情面板 — 七个 widget 全览

两列卡片布局；每个 widget 都有「详情 + 悬浮」两种表达，支持拖拽排序、折叠、隐藏、pin。

<table><tr>
<td>

| Widget | 功能 |
| --- | --- |
| 💳 **余额** | 左侧大数字 + 右侧「可用 / 充值 / 赠送」三行明细，供应商可切换 |
| 📊 **今日用量** | 今日 token 总数 + 输入 / 输出 / 缓存读分桶 |
| 📈 **本月用量** | 本月累计 token + 同样的分桶明细 |
| 🎯 **缓存命中** | 今日与累计缓存命中率 |
| ↔️ **通道比例** | DSH 通道 vs Claude Code 通道的占比条 |
| 📜 **用量记录** | 近 14 天按日列表，点击下钻到模型明细 |
| 🔥 **活跃热力图** | 28 天 × 6 时段点块网格（横轴日期，纵轴 0–24 时） |

</td>
<td width="46%"><img src="docs/images/panel.png" alt="dsh-usage 详情面板" width="100%"></td>
</tr></table>

### 🎨 一切皆可自定义

主色调（预设色板 + 取色器）、背景色、面板不透明度随时可调；拖拽排序、pin、折叠、隐藏——每个数字都按你的方式呈现，正如 DeepSeek Harness 的「一切皆插件」。

<p align="center"><img src="docs/images/customizer.png" alt="dsh-usage 自定义面板" width="78%"></p>

## 一眼看懂

| | 能力 | 说明 |
| --- | --- | --- |
| 💳 | 常驻悬浮窗 | pinned 项始终可见；sidebar 收起时折叠为余额胶囊按钮 |
| 🎨 | 一切皆可自定义 | 每个 widget 可 pin / 折叠 / 隐藏 / 拖拽排序（虚线占位 + 平滑让位动画）；主色、背景、不透明度可调；设置持久化 localStorage |
| 📊 | 余额与用量面板 | 供应商切换、余额明细、今日/本月总量（k/M/B 紧凑单位）、缓存命中、用量记录与按模型下钻 |
| 🔥 | 活跃热力图 | GitHub 风格点块：28 天 × 6 时段（每格 4 小时）+ 顶部日期标签 |
| ↔️ | 通道比例 | DSH 通道 vs Claude Code 通道（解析 `~/.claude/projects` JSONL 增量聚合） |
| 🔄 | 后台刷新 | 启动即刷新，之后每 5 分钟更新余额、DSH Token 与 Claude Code 聚合 |
| 🔒 | 本机安全边界 | 三个端点仅接受回环 GET；凭据只在服务端解析；上游强制 HTTPS、拒绝私网解析并固定 DNS 连接；Claude 日志只聚合数字，对话文本永不落盘 |

界面支持中文和英文。凭据由 Harness 从 `~/.dsh/.credentials.yaml` 解析，插件不读取、不缓存、不回传任何密钥。

## 快速安装

需要 DeepSeek Harness `web` profile（`@deepseek-ai/dsh >= 0.1.0-rc.6`）。

```bash
dsh plugin --profile web add "github:Aisland-SJL/dsh-usage"
```

重启 `dsh web` 并在浏览器硬刷新，左下角出现常驻悬浮窗。更新 / 卸载：

```bash
dsh plugin --profile web update dsh-usage
dsh plugin --profile web remove dsh-usage
```

## 凭据配置

余额型供应商的凭据引用写在 `~/.dsh/.credentials.yaml`：

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
- 用量缓存 `~/.dsh/storages/` 只保存聚合 Token 与会话折叠游标，不保存提示词或回复内容。
- Claude Code 日志逐行解析即弃，只有聚合数字进入缓存。
- 请勿将本插件端点经反向代理暴露到局域网或公网。

## 致谢

- [Ychris12138/dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats)（MIT）：余额 scheme 与 Token 折叠语义、DSH bundle 插件结构与安全边界的参考实现。

## License

[MIT](LICENSE)
