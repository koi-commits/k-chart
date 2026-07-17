# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

基于 Electron 的 K线模拟器桌面应用。实时生成模拟K线数据，支持技术指标、画线工具、模拟交易（A股费率+市场冲击模型）、历史回放、多股票管理。纯 HTML/CSS/JS，无框架，无构建步骤。

## 常用命令

```powershell
# 开发模式运行（直接加载 HTML，无需构建）
npm start

# 构建 Windows 便携版 .exe（输出到 dist/）
# 国内网络需设置 Electron 镜像：
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm run build
```

## 架构

```
kline-simulator/
├── main.js              # Electron 主进程 — BrowserWindow + IPC 代理 HTTP
├── preload.js           # contextBridge 暴露 marketAPI.fetch 给渲染进程
├── index.html           # 渲染进程 UI，通过 <script> 标签加载所有 JS
├── css/style.css        # 同花顺风格暗/亮双主题，CSS 自定义属性
├── js/
│   ├── simulator.js     # K线数据引擎 — GBM + EWMA 动态波动率
│   ├── trader.js        # 交易引擎 — A股费率 + 市场冲击 + SL/TP
│   ├── chart.js         # lightweight-charts v4 图表渲染 + 技术指标
│   ├── market-sentiment.js  # 市场情绪指数 — 实时数据抓取 + 波动率调节
│   └── app.js           # 主控制器 — IIFE，连接所有模块
├── lib/
│   └── lightweight-charts.js  # v4.2 UMD 构建（必须从 node_modules 复制）
├── icons/               # 应用图标
└── dist/                # 构建输出
```

所有 JS 模块使用 **IIFE 模式**（`const Module = (() => {...})()`），通过全局变量互相引用。脚本加载顺序必须为：`simulator.js` → `trader.js` → `chart.js` → `market-sentiment.js` → `app.js`。

### 主进程与渲染进程通信

- `main.js` 注册 IPC handler `fetch-url`，主进程代理所有 HTTP 请求以绕过 CORS
- `preload.js` 通过 `contextBridge.exposeInMainWorld('marketAPI', {...})` 暴露 `fetch()`/`fetchJSON()` 给渲染进程
- `contextIsolation: true` + `nodeIntegration: false`，渲染进程只能通过 `preload` 访问 Node 能力

## 关键实现细节

### 价格模拟 (simulator.js)
- **模型**: 几何布朗运动 (GBM) — `S_t = S_{t-1} * exp((μ-σ²/2)dt + σ√dt·Z)`
- **动态波动率**: EWMA 波动率聚类 (λ=0.995)，70%动态 + 30%长期均值锚定
- **参数**: 年化波动率 + 年化趋势，`dt = 1/(252*390)` 为1分钟尺度，`√dt` 自动缩放适配所有周期
- **涨跌停**: 基于前一日收盘价，可配置比例（主板±10%，创业/科创±20%）
- **OHLC 构建**: 指数分布厚尾高低点，量价联动
- **周期聚合**: 1分钟tick → 聚合到5m/15m/1h/1d/1w，按时间桶分组

### 图表渲染 (chart.js)
- 4个同步图表：主图(K线+MA+BOLL) + 成交量 + MACD + RSI/KDJ（可切换）
- 图表同步通过 `subscribeVisibleLogicalRangeChange` 实现
- `getCandleSeries()` 直接返回 candleSeries 引用 — **不要用 `chart.series()`**（LC v4 UMD 中此方法不存在）
- 颜色函数名是 `clr()`（不是 `c()`，避免与 `.map()` 回调参数冲突）

### 画线工具 (app.js)
- **水平线**: 使用 `series.createPriceLine()`（LC 原生，已验证可用）
- **趋势线**: 使用 **SVG 覆盖层** (`#drawSvg`) 画无限延伸的直线 — **不要用 `addLineSeries().setData()`**（LC v4 UMD 中动态添加的线系列 `setData`/`update` 会触发内部 minified 方法不存在错误）
- 点击事件通过 `#mainChart` 上的**捕获阶段监听器** (`addEventListener('click', handler, true)`) 在 LC 内部处理器之前拦截
- 画线按钮使用 HTML 内联 `onclick`（`onclick="App.activateDraw('trend')"`）

### 交易引擎 (trader.js)
- A股费率：佣金万2.5(最低¥5) + 印花税千1(仅卖出) + 过户费万0.2
- 市场冲击：平方根模型 + 五档盘口深度消耗
- SL/TP 挂单每个 tick 自动检查
- localStorage 持久化账户状态

### 主题
CSS 自定义属性 `[data-theme="dark"]`，dark 为默认。`isDark()` 辅助函数判断 `documentElement.dataset.theme !== 'light'`。

## LC v4 UMD 兼容性陷阱

`lib/lightweight-charts.js` 是 v4.2 UMD 构建（163KB），直接从 node_modules 复制。此构建与标准 API 有以下差异：

| 标准 API | UMD 行为 |
|----------|---------|
| `chart.series()` | **不可用** — 抛出 "is not a function" |
| `series.setData()` 在动态创建的线系列上 | **内部报错** — `coordinateToPrice is not a function`（minified 方法名不匹配） |
| `series.update()` 在动态创建的线系列上 | **同上** |
| `chart.removeSeries()` | **可能不可用** |
| `createPriceLine()` | ✅ 正常 |
| MA/BOLL 等初始化时创建的线系列 `setData()` | ✅ 正常 |
| `coordinateToPrice()` | ✅ 正常 |
| `coordinateToTime()` | ✅ 正常 |
| `subscribeCrosshairMove()` | ✅ 正常 |

**规则**: 需要线系列引用时，通过 `ChartManager` 暴露专用 getter（如 `getCandleSeries()`），不要动态调用 `chart.series()` 或给动态创建的线系列设置数据。

## 股票配置

股票参数定义在 `Simulator.STOCKS`，`simulator.js` 中。关键字段：
- `annualVol`: 年化波动率（0.19=大盘蓝筹, 0.30=创业板, 0.40=小盘概念股）
- `limitPct`: 涨跌停幅度（0.10 或 0.20）
- `trend`: 年化趋势（如 0.05 = 5%）
- `sector`: 板块标识 (main/chinext/star)

兼容旧配置：`addStock()` 接受 `annualVol` 或旧的 `volatility` 字段，`normalizeConfig()` 自动转换。
