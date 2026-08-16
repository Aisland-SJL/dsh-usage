# dsh-usage 项目规则

## 结构

| 文件 | 职责 |
| --- | --- |
| `lib/index.js` | 服务端 Cordis 插件：3 个回环 GET 端点、凭据 seam、5 分钟后台刷新 |
| `lib/usage.js` | token 折叠纯函数（按日/模型/24 小时桶，同 turn/step 替换语义） |
| `lib/balance.js` | 余额 scheme 注册表（DeepSeek/OpenRouter/Moonshot/Z.ai） |
| `lib/safe-fetch.js` | 上游安全请求：HTTPS 强制、DNS 固定防 rebinding、1 MiB 上限 |
| `lib/claude.js` | Claude Code JSONL 增量聚合（只存数字+游标） |
| `lib/client.js` | 客户端 widget 体系：无构建 `__ModuleLoader__` bundle（手写 jsx-runtime） |
| `scripts/test-*.mjs` | 离线测试（balance/usage/server/client/e2e/claude） |
| `vendor/` | DSH 客户端加载器 fixture（MIT，供真实 loader 预演测试） |

## 红线

- 三个端点只接受回环 GET（peer socket 校验），绝不向公网/局域网开放。
- Claude JSONL 只聚合数字：对话文本永不落盘、永不进浏览器响应。
- 凭据只经 Harness credentials seam 解析，永不进响应/缓存/日志。
- 客户端无构建步骤：禁止引入 JSX 构建器依赖；改 `lib/client.js` 手写 `react_jsx_runtime` 调用。
- 不要用 PowerShell 正则替换修改 `lib/` 源码（曾因此清空过文件）；一律用编辑工具逐段修改。
- 服务端改动必须重启 `dsh web` 才生效；纯客户端改动硬刷新即可。

## 常用命令

```bash
npm run check        # 全量语法检查
npm test             # 81 个离线测试，全绿才可提交
node scripts/validate-claude.mjs          # 真实 ~/.claude 数据预演
node scripts/proxy-fetch.mjs <url>        # 沙箱内经 127.0.0.1:7890 代理拉取 https
node scripts/github-research.mjs          # GitHub 星数调研（走代理，带重试）
```

## 关键约定

- 客户端设置持久化于 localStorage `dsh-usage:settings:v1`；`defaultSettings()` 即产品预设，改动需同步 e2e 断言。
- 服务端缓存版本变更必须同步升 `CACHE_VERSION`（usage-cache.json v2 / claude cache v1），旧缓存自动失效重算。
- 拖拽排序用 ghost 占位方案：拖拽中不改布局，drop 时一次性提交 + FLIP 动画。
- 测试字典从插件 `apply()` 捕获，禁止在测试里维护字典副本。
- 悬浮窗仅余额用主题色；其余信息用中性色阶。
- 可 pin 的 widget 白名单：balance/today/month/hit；其余在 `WIDGET_PINABLE` 中禁用。

## 深入文档

- 安装与外部使用：`README.md`
- 设计迭代与回退点：`git log`（关键检查点均带描述性 commit message）
