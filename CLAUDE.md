# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库工作时提供指引。

## 项目概览

基于 Electron 的**回合制股市策略游戏**（v0 原型）。玩家从 10 万本金的散户起步，靠研究、判断和资金管理赚钱。核心原则是"决策有因果"：赢要靠研究和判断，不能靠运气猜涨跌。v0 只验证一件事：**做研究的玩家是否明显比不做的赚得多**（由 `scripts/simulate.js` 验证）。

纯 HTML/CSS/JS，无框架，无构建步骤。原版实时 K 线模拟器保留在 `archive/simulator` 分支。

**v0 范围之外（不要加）**：科技树、AI 对手、成就系统。

## 常用命令

```bash
npm start                      # 运行游戏（electron 直接加载 index.html）
node scripts/simulate.js       # 平衡测试：随机 bot vs 研究 bot，各 1000 局（约 35 秒）
node scripts/simulate.js 200 7 # 可选参数：局数、起始种子
npm run build                  # 构建 Windows 便携版（国内网络先设置 ELECTRON_MIRROR）
```

没有单元测试框架；改规则/参数后必须跑 `simulate.js`，验收标准是研究 bot 的平均收益率明显高于随机 bot。

## 游戏规则

- 本金 ¥100,000；共 20 回合，**每回合 = 一周 = 5 个交易日**。
- 回合结束时总资产 < ¥30,000 判负；第 20 回合结束时结算总资产、收益率、最大回撤（按每日总资产计算）。
- 4 家虚构公司（白酒/新能源/地产/半导体各 1 家），玩家看不到真实价值 V、增长率、波动率、负债水平。
- 每回合 3 个研究点：对某公司投入 n 点，得到 V 的估计值，误差 σ = 0.18 × 0.55^(n-1)（ln V 的标准差）；估计 4 回合后过期，重新研究覆盖旧估计。
- 订单在**下周一开盘价**成交（先卖后买）。A 股费率、平方根市场冲击、T+1（当日买入不可卖）、涨停买不进/跌停卖不出。
- 事件在新闻中只给方向性线索，不给数值。新闻展示的是**上一周已发生**的事件（价格已经反映），用来判断价格波动是基本面（V 变了）还是情绪（s 变了）。

## 架构

```
├── main.js            # Electron 主进程：只创建窗口（不再代理 HTTP，游戏不抓取真实数据）
├── preload.js         # 空（contextIsolation: true，渲染进程不需要 Node 能力）
├── index.html         # 界面骨架，按顺序加载所有脚本
├── css/style.css      # 暗色主题，红涨绿跌
├── lib/lightweight-charts.js   # v4.2 UMD（必须从 node_modules 复制）
├── js/
│   ├── game/          # ★ 纯逻辑，不碰 DOM，浏览器全局变量 + Node module.exports 双用
│   │   ├── config.js      # 所有数值参数集中在这里
│   │   ├── rng.js         # mulberry32 可设种子 PRNG（游戏逻辑禁止 Math.random）
│   │   ├── companies.js   # 4 家公司的隐藏属性
│   │   ├── events.js      # 10 张事件卡（数据驱动）+ 抽取/结算
│   │   ├── market.js      # P = V·exp(s+ε)，每回合生成 5 根日 K
│   │   ├── research.js    # 研究点 → V 的估计
│   │   ├── trading.js     # 费率/冲击/T+1/涨跌停，纯函数
│   │   └── game-state.js  # newGame() 与 advanceTurn(state, actions) -> newState
│   ├── ui/            # 界面层
│   │   ├── save.js        # localStorage 自动存档（单槽，无手动读档）
│   │   ├── view.js        # 纯渲染（state + ui → DOM）
│   │   └── replay.js      # 结束回合后 5 根日 K 逐根回放（约 2 秒）
│   ├── app.js         # 控制器：事件委托 → 调用 game/ 纯函数 → 存档/回放
│   └── chart.js       # lightweight-charts 封装（K 线 + MA/BOLL + 成交量 + MACD + RSI/KDJ）
├── scripts/simulate.js    # 平衡测试（Node，无 DOM）
└── icons/ dist/
```

脚本加载顺序（index.html）：`lightweight-charts` → `game/config` → `rng` → `companies` → `events` → `market` → `research` → `trading` → `game-state` → `chart` → `ui/save` → `ui/view` → `ui/replay` → `app`。所有模块是 UMD/IIFE，通过全局变量互相引用（`GameConfig`、`GameRng`、`GameState`、`ChartManager`、`App` 等）。

### 遗留文件（仍在仓库，但 index.html 不加载）

`js/simulator.js`、`js/trader.js`（旧实时模拟器引擎）、`js/patterns.js`、`js/ordertypes.js`、`js/backtest.js`、`js/tutorial-*.js`、`js/save-manager.js`。它们属于旧版，不要在新代码里引用；确认不需要后可删除（`archive/simulator` 有备份）。

## 关键实现细节

### 价格模型（market.js）
- `P = V · exp(s + ε)`；情绪每日 `s_next = κ·s + η`（κ=0.96，向 0 回归）；ε 为当日噪声。
- V 按增长率 + 扩散（扩散 ×(1+负债)）演化；事件在周内第 1 日起作用：`V *= exp(vLog)`，`s += sShift`。事件对 V 的冲击 ×(1+负债水平)。
- 收盘价 = 目标价，受 ±10% 涨跌停约束；开盘价承接上一日未完成的变动（`openCarry`），所以大事件会形成连续涨停。
- 玩家的"edge"来源：价格对 V 的偏离（即 s）会回归；研究让玩家估出 V，从而估出 s。

### 纯函数与随机流（game-state.js）
- `advanceTurn(state, actions)` 不修改入参，返回新 state。`actions = { research?: [{id, points}], orders?: [{id, side, shares}] }`。
- state 里有 3 条独立随机流（`rng.market/events/research`，各存一个 uint32）：**玩家行动不改变价格路径**，同一种子下不同玩家/bot 面对完全相同的市场，可做配对比较。
- state 含隐藏真相（`companies[id].V` 等）。UI 与 bot 不得读取它们（结算界面除外）；bot 只用 `candles`、`cash`、`positions`、`Research.getEstimate()`。
- 研究在 UI 中是即时操作（`GameResearch.research(state, id, points)` → 新 state），好让玩家看到估值后再下单；研究后立即存档，防止读档重抽。

### 图表（chart.js）
- 4 个同步图表：主图 + 成交量 + MACD + RSI/KDJ，同步用 `subscribeVisibleLogicalRangeChange`。
- `updateData(candles, visibleBars)` 期望 `time` 为**毫秒**（内部 `/1000`）；game/ 里的 K 线 `time` 是**秒**，`GameReplay.toChart()` 负责转换。
- `getCandleSeries()` 直接返回 candleSeries 引用 — **不要用 `chart.series()`**（LC v4 UMD 中此方法不存在）。
- 颜色函数名是 `clr()`（不是 `c()`，避免与 `.map()` 回调参数冲突）。

## LC v4 UMD 兼容性陷阱

`lib/lightweight-charts.js` 是 v4.2 UMD 构建，直接从 node_modules 复制，与标准 API 有差异：

| 标准 API | UMD 行为 |
|----------|---------|
| `chart.series()` | **不可用** |
| `series.setData()/update()` 在动态创建的线系列上 | **内部报错**（minified 方法名不匹配） |
| `chart.removeSeries()` | **可能不可用** |
| `createPriceLine()`、初始化时创建的线系列 `setData()`、`coordinateToPrice/Time()`、`subscribeCrosshairMove()` | ✅ 正常 |

**规则**：需要新的线系列，在 `ChartManager.init()` 里一次性创建，通过专用 getter 暴露；不要动态创建后再 `setData`。

## 修改参数的流程

所有数值在 `js/game/config.js`（公司隐藏属性在 `companies.js`，事件数值在 `events.js` 的 `CARDS`）。改完运行 `node scripts/simulate.js`，确认研究 bot 仍明显优于随机 bot，并在提交信息里写明改了什么、为什么。
