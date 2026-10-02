# dsh-usage 项目规则

## 结构

| 文件 | 职责 |
| --- | --- |
| `lib/index.js` | 服务端 Cordis 插件：3 个回环 GET 端点、凭据 seam、5 分钟后台刷新 |
| `lib/usage.js` | token 折叠纯函数（按日/模型/24 小时桶，同 turn/step 替换；retry-started 另算新尝试） |
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
- `lib/client.js` 引用的非 DSH 基础前端包必须同时写入 `dependencies` 与 `dsh.client.inject`；发布前必须在无工作区 junction 的干净 hoisted profile 中安装最终包验证。
- 不要用 PowerShell 正则替换修改 `lib/` 源码（曾因此清空过文件）；一律用编辑工具逐段修改。
- 服务端改动必须重启 `dsh web` 才生效；纯客户端改动硬刷新即可。

## 常用命令

```bash
npm run check        # 全量语法检查
npm test             # 112 个离线测试，全绿才可提交
npm run test:package # 发布依赖与 client inject 契约
node scripts/validate-claude.mjs          # 真实 ~/.claude 数据预演
node scripts/proxy-fetch.mjs <url>        # 沙箱内经 127.0.0.1:7890 代理拉取 https
node scripts/github-research.mjs          # GitHub 星数调研（走代理，带重试）
npm run test:modern  # 22 项 0.2 契约回归；参数可指定安装目录和固定 SDK 的 node_modules
```

## 关键约定

- Desktop 0.2.0-rc.2 开发候选保留 client.platform=web；桌面包管理只能用桌面自带 CLI 与 desktop profile。升级提示按 dsh-app: 区分环境，不把网页端的更新与重启指令给桌面用户；离线通过不等于真实桌面验收。
- 客户端设置持久化于 localStorage `dsh-usage:settings:v1`；`defaultSettings()` 即产品预设，改动需同步 e2e 断言。
- 服务端缓存版本变更必须同步升 `CACHE_VERSION`（usage-cache.json v4 / claude cache v1），旧缓存自动失效重算。
- 单条会话读取/关闭失败不得拖垮其他用量；失败记录清除旧折叠缓存且下次重试，API 必须返回 coverage（宿主列出的 totalSessions/countedSessions/skippedSessions）。partial 显示仅可读小计与明确告警，unavailable 的 total=null、界面为「—」，不可当成零或宣称完整统计；会话列表整体失败仍为错误。只经官方 read handle，不降级解压/改写真实历史日志。
- 0.2 会话经 persistence.list/open('read')/read(0)/finally close；变化的 revision 全量重算、fork 继承前缀不重复计费，opaque revision 只留内存且按 service identity 隔离。旧 events/readFrom 分支保留，但候选包的整套旧宿主 GUI 尚未复验。
- 隔离验收必须设 config.balanceEnabled=false（禁止解析凭据与上游请求），同时显式隔离 CLAUDE_CONFIG_DIR；不能运行真实 Claude 验证脚本或把离线桩测试写成真实账号验收。
- 拖拽排序用 ghost 占位方案：拖拽中不改布局，drop 时一次性提交 + FLIP 动画。
- 测试字典从插件 `apply()` 捕获，禁止在测试里维护字典副本。
- 悬浮窗仅余额用主题色；其余信息用中性色阶。
- 可 pin 的 widget 白名单：balance/today/month/hit；其余在 `WIDGET_PINABLE` 中禁用。

## 深入文档

- 安装与外部使用：`README.md`
- 设计迭代与回退点：`git log`（关键检查点均带描述性 commit message）
