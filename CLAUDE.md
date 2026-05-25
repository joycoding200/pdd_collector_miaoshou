# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

拼多多商品信息抓取工具 — Chrome 扩展 + Node.js 激活服务器。扩展注入拼多多移动端商品页面，模拟人工浏览抓取商品标题、主图、详情图、SKU 价格/图片，导出为 Excel 供妙手 ERP（跨境）导入。激活服务器管理 License 激活码的生成、验证和设备绑定。

## 常用命令

### 激活服务器 (`activation-server/`)

```bash
cd activation-server
npm install                    # 安装依赖
npm start                      # 启动服务器 (node server.js)
pm2 start ecosystem.config.js  # 生产环境启动
```

服务器默认运行在 `http://localhost:3000`，管理后台 `/admin`。

### Chrome 扩展 (`chrome-extension/`)

无构建步骤。在 Chrome `chrome://extensions` 中加载为"未打包的扩展"，选择 `chrome-extension/` 目录即可。manifest.json 中修改版本号后需点击刷新。

## 架构

### 两大组件

```
chrome-extension/          ← Manifest V3 扩展,注入拼多多页面
activation-server/         ← Express + SQLite 激活码管理后台
sales-page.html            ← 独立销售页面(展示支付二维码)
```

### 扩展内部通信链路

```
popup (工具栏弹窗)
  ↓ chrome.runtime.sendMessage
background/background.js (Service Worker)
  ↓ chrome.runtime.sendMessage / chrome.storage
content/content.js (注入页面的主脚本)
  ↓ postMessage (iframe通信)
panel/panel.js (页面内嵌操作面板)
```

- **background.js**: Service Worker。负责激活码激活、设备指纹生成(Web Crypto SHA-256)、定期验证(`chrome.alarms` 每60分钟)和消息路由。`background_v2.js` 内容完全相同。
- **content.js**: 核心采集逻辑。注入拼多多商品页，模拟人工浏览滚动/点击SKU弹窗、遍历SKU组合获取价格/图片、通过 SheetJS 导出 XLSX(CSV降级)。采集数据存储于 `chrome.storage.local`(上限100条)。
- **panel.js**: 通过 `<iframe>` 嵌入页面。未激活时显示激活码输入界面，激活后收缩为底部横条(采集/导出按钮，header与按钮并排)。试用中显示紧凑横条，试用用完时工具栏保留（采集禁用、导出可用）+ 激活表单同时显示，中间有分割线。通过 `postMessage` 与 content.js 通信。关闭按钮固定在面板右上角。
- **popup.js**: 工具栏弹窗，仅用于手动激活/验证/解绑管理。

### 激活验证流程

1. 用户输入36位 UUID 激活码 → panel.js `postMessage` → content.js `chrome.runtime.sendMessage` → background.js
2. background.js 生成设备指纹 + 调用 `/api/plugin/activate` → 激活服务器
3. 服务器 SHA-256(code + SECRET_KEY) 验证 → 绑定 hardware_id → 返回激活结果
4. 之后每60分钟 Service Worker 自动调用 `/api/plugin/verify` 验证设备身份

### 激活服务器 API

| 路径 | 用途 |
|------|------|
| `POST /api/plugin/activate` | 插件激活 |
| `POST /api/plugin/verify` | 验证激活状态 |
| `POST /api/plugin/deactivate` | 解绑设备 |
| `POST /api/admin/login` | 管理员登录 |
| `POST /api/admin/generate-codes` | 批量生成激活码(需认证) |
| `GET /api/admin/codes` | 激活码列表(需认证) |

### 数据库表结构

SQLite (`activation-server/database.db`)，三张表：
- `activation_codes` — 激活码: code_hash, original_code(UUID), hardware_id, max_activations, activation_count, expires_at, status(active/inactive/expired/revoked)
- `activation_logs` — 操作日志: activate/verify/suspicious_device
- `admins` — 管理员: bcrypt 密码哈希, 登录 token

### Excel 导出格式

采集数据通过 SheetJS (xlsx.full.min.js) 导出为妙手 ERP 兼容格式。表头: 产品主编号、产品名称、货币类型(CNY)、产品主图、货源链接、详情图、SKU规格1、SKU规格2、SKU售价、SKU图片、SKU库存。每个 SKU 对应一行，无 SKU 时导出默认行。XLSX 失败时降级为带 UTF-8 BOM 的 CSV。

### 试用模式

未激活时每个设备可免费采集 3 个商品，超过后需激活才能继续采集。试用数据存储在 `chrome.storage.local.trialData`：

```json
{ "count": 2, "signature": "abc123..." }
```

- `count` 明文（展示用），`signature` = HMAC-SHA256(`count=<n>|fp=<deviceFingerprint>`, TRIAL_SECRET)
- `TRIAL_SECRET` 硬编码在 `background.js` 中，与 `deviceFingerprint` 绑定防止跨设备复制
- 每次读取重新验签，签名不匹配 → 标记篡改 → count=0
- 采集点击时立即扣减（不等采集完成），采集完成后刷新面板状态
- 重置试用：扩展 Service Worker 控制台执行 `chrome.storage.local.remove(['trialData'])`

### 面板三种模式

| 模式 | 触发条件 | iframe 尺寸 | 布局 |
|------|---------|------------|------|
| 工具栏 | 已激活 或 试用中 | 400×60px | header+按钮并排，垂直居中 |
| 试用用完 | 试用次数=0 且采集已完成 | 400×550px | 工具栏(采集禁用)+分割线+激活表单 |
| 激活表单 | 从未激活 | 400×550px | 仅激活表单 |

## 注意事项

- `.env` 包含 SECRET_KEY 和默认管理员凭据，**不可提交到版本控制**
- 扩展目前**仅支持最多2个 SKU 规格**的商品（妙手 ERP 导入限制），超过会弹错误提示
- `common/utils.js` 和 `common/style.css` 目前为空文件
- `content_v2.js` 为空文件；`background_v2.js` 与 `background.js` 内容相同
- 采集模拟了人工行为（随机延迟、滚动、鼠标事件），调整 `CONFIG.minCollectionInterval` 和 `CONFIG.maxCollectionsPerHour` 控制频率
- 扩展仅在 `mobile.yangkeduo.com` 和 `*.pinduoduo.com` 域名下激活

## 踩坑记录

### 1. `@media (max-height: 700px)` 导致面板高度失控

面板 CSS 中 `@media (max-height: 700px)` 设置了 `.panel-container { min-height: 450px }`。60px iframe 高度触发该媒体查询，`min-height: 450px` 强制面板撑大到 450px，按钮被推到 iframe 可见区域之外。表现：工具栏按钮完全看不见。

**解决**：将媒体查询中 `min-height: 450px` → `min-height: auto`，同时在 JS 中工具栏模式通过 `setProperty('height', '60px', 'important')` 内联强制设高。

### 2. panel `position: fixed` 的 `right: 20px; bottom: 20px` 与 iframe 产生偏离

panel 在 iframe 内使用 `position: fixed; right: 20px; bottom: 20px; width: 100%`，right/bottom 的 20px 偏移导致 panel 比 iframe 小一圈，body（`background: transparent`）透出形成"双层边框"效果。

**解决**：panel `right: 0; bottom: 0`，JS `updateUI` 中内联强制 `panel.style.right = '0px'; panel.style.bottom = '0px'; panel.style.width = '100%'`。body 背景改为 `#f5f5f5`。

### 3. panel `border` + `box-shadow` 与 iframe `box-shadow` 叠加

panel-container 自带 `border: 1px` 和 `box-shadow`，iframe 也有 `box-shadow`，三层层叠产生厚重外框。

**解决**：panel `border: none; box-shadow: none`。视觉边界由 iframe 统一管理。

### 4. `justify-content: space-between` 导致按钮与关闭按钮重叠

panel-inner 使用 `space-between` 将 header 推到最左、按钮推到最右，与右上角的关闭按钮重叠，导出按钮被遮挡。

**解决**：改为 `justify-content: flex-start; gap: 12px`，panel-inner 右侧 `padding-right: 30px` 为关闭按钮留空。

### 5. `postMessage` 误用扩展 origin 为目标源

panel.js 向父窗口（拼多多页面）发消息时使用了 `EXTENSION_ORIGIN`（`chrome-extension://xxx`），但父窗口 origin 是 `https://mobile.yangkeduo.com`，浏览器拒绝投递。

**解决**：panel → 父窗口的 `postMessage` 目标源使用 `'*'`。安全校验由 content.js 接收端通过 `event.source === iframe.contentWindow && event.origin === pluginOrigin` 实现。

### 6. 激活容器 `pointer-events: auto` 拦截按钮点击

试用模式下激活容器和工具栏同时显示时，激活容器的 `z-index` 高于按钮，`pointer-events: auto` 拦截了所有鼠标事件。

**解决**：试用模式隐藏激活表单（`display: none`），试用用完时再显示。

### 7. 扩展 CSS 缓存

修改 panel.css 后仅刷新页面（Ctrl+Shift+R）不会重新加载 CSS 文件。必须在 `chrome://extensions` 中点击扩展的刷新图标。

### 8. `console.log` JSHandle@node

在 Playwright/CDP 中 `page.evaluate` 返回的 DOM 元素会序列化为 `JSHandle@node`，需在 JS 表达式中直接提取属性值而非返回元素引用。
