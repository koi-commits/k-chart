# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库工作时提供指引。

## 项目概览

基于 Electron 的**回合制股市策略游戏**（v0 原型）。玩家从 10 万本金的散户起步，靠研究、判断和资金管理赚钱。核心原则是"决策有因果"：赢要靠研究和判断，不能靠运气猜涨跌。v0 只验证一件事：**做研究的玩家是否明显比不做的赚得多**（由 `scripts/simulate.js` 验证）。

纯 HTML/CSS/JS，无框架，无构建步骤。原版实时 K 线模拟器保留在 `archive/simulator` 分支。

**v0 范围之外（不要加）**：科技树、AI 对手、成就系统。

## 常用命令

```bash
npm start                      # 运行游戏（electron 直接加载 index.html）
npm test                       # 单元测试（node:test，tests/ 目录）
node scripts/simulate.js       # 平衡测试：研究/随机估值/随机交易/等权持有/押单一公司/躺平 共 11 个 bot，各 1000 局（约 2.5 分钟）
node scripts/simulate.js 200 7 # 可选参数：局数、起始种子
npm run build                  # 构建 Windows 便携版（国内网络先设置 ELECTRON_MIRROR）
```

改规则/参数后必须跑 `npm test` 与 `simulate.js`。`simulate.js` 末尾内置 7 条验收检查（见下文"平衡验收标准"），全部 ✔ 才算平衡。

## 游戏规则

- 本金 ¥100,000；共 20 回合，**每回合 = 一周 = 5 个交易日**。
- 回合结束时总资产 < ¥30,000 判负；第 20 回合结束时结算总资产、收益率、最大回撤（按每日总资产计算）。
- **评分与评级（取代原来的三条硬性胜利条件）**：总分 = 4 个季度分 + 终局分 − 回撤扣分；按总分评 S/A/B/C/D，**B 及以上过关**。所有权重、上下限、阈值、等级线都在 `config.scoring`，逻辑在 `js/game/scoring.js`（纯数字函数）。
  - 超额收益 = 玩家收益率 − 等权基准收益率（百分点）。基准 = 第 1 回合开盘价把本金平均买入 4 家、持有到结束、不计费用。
  - **季度分**：每季度超额 > 0 得基础分 `beatBase`，超额每个百分点再 ±`perPoint`；单季度限制在 `[min, max]`。
  - **终局分**：全局超额 × `perPoint`，限制在 `[min, max]`。
  - **回撤扣分**：最大回撤超过 `threshold` 的部分每个百分点扣 `perPoint` 分，**不设硬性上限**（连续扣分）。
  - 中途判负（总资产 < ¥30,000）：一律评 D。
  - 界面**不提示"已无法获胜/过关"**；顶部只显示当前总分（若现在结束）、预估等级、本季度目前得分、距下一等级还差多少分。"提前判死"只是平衡统计指标（`GameSummary.outlook`），不给玩家看。
- **季度**：20 回合 = 4 个季度 × 5 回合，季度末弹出成绩单（得分构成）。季度收益 = 季度末总资产 / 上季度末总资产 − 1（第 1 季度从本金起算）；基准用等权持有指数同样分季度计算。公式在 `game-state.js` 的 `quarterResults`（按"已过交易日数 d"，`equity[d]` 与基准指数对齐）；各季度收益复利后等于总收益（有测试）。
- 4 家虚构公司（白酒/新能源/地产/半导体各 1 家，名称与行业固定），玩家看不到真实价值 V、增长率、波动率、负债水平。**这些参数每局由种子在各行业范围内随机生成**（`config.industries`；范围重叠、growth 区间中点相同），所以没有固定的最优股票。
- 每回合 3 个研究点：对某公司投入 n 点，得到 V 的估计值，误差 σ = 0.18 × 0.55^(n-1)（ln V 的标准差）；估计 4 回合后过期，重新研究覆盖旧估计。
- 订单在**下周一开盘价**成交（先卖后买）。下单校验的可用资金 = 现金 + 待卖出订单按现价估算的所得（扣费用）。开盘实际资金不足时，买单**按下单顺序**成交，不足的按可买手数**部分成交**，剩余标记为"资金不足未成交"（记入 `failedLog`，回合小结里说明）。A 股费率、平方根市场冲击、T+1（当日买入不可卖）、涨停买不进/跌停卖不出。
- 事件在新闻中只给方向性线索，不给数值。每张事件卡（`events.js`）有 `dir`（利好/利空）和重/轻两档标题（由抽到的强度决定，措辞本身有区分度，如"重大长期合同"vs"常规供货订单"）；**不允许**出现"公司称经营一切正常""基本面无明显变化"这类直接暴露类型的尾句；基本面与情绪标题刻意共用词汇，测试保证不存在能 100% 区分类型的单个关键词。同一周同一家公司不会同时出现方向相反的两条新闻。改标题后要跑测试。新闻展示的是**上一周已发生**的事件（价格已经反映），用来判断价格波动是基本面（V 变了）还是情绪（s 变了）。

## 架构

```
├── main.js            # Electron 主进程：普通窗口 1280×800、F11 全屏/Esc 退出全屏、IPC（quit-app、save-record 保存对话框）。不联网，不抓取真实数据
├── preload.js         # contextBridge 暴露 gameAPI.quit / gameAPI.saveRecord（contextIsolation: true，渲染进程无 Node 权限）
├── index.html         # 界面骨架，按顺序加载所有脚本
├── css/style.css      # 暗色主题，红涨绿跌
├── lib/lightweight-charts.js   # v4.2 UMD（必须从 node_modules 复制）
├── js/
│   ├── game/          # ★ 纯逻辑，不碰 DOM，浏览器全局变量 + Node module.exports 双用
│   │   ├── config.js      # 所有数值参数集中在这里
│   │   ├── rng.js         # mulberry32 可设种子 PRNG（游戏逻辑禁止 Math.random）
│   │   ├── companies.js   # 4 家公司的名称/行业 + generate(rng) 按种子生成隐藏属性
│   │   ├── events.js      # 10 张事件卡（数据驱动）+ 抽取/结算
│   │   ├── market.js      # P = V·exp(s+ε)，每回合生成 5 根日 K
│   │   ├── research.js    # 研究点 → V 的估计
│   │   ├── trading.js     # 费率/冲击/T+1/涨跌停，纯函数
│   │   ├── scoring.js     # 评分与评级：季度分/终局分/回撤扣分/等级/提前判死上界（纯数字，读 config.scoring）
│   │   ├── game-state.js  # newGame() 与 advanceTurn(state, actions) -> newState
│   │   ├── record.js      # 试玩记录（行动/耗时/结果）与 replay(record) 重放
│   │   └── summary.js     # 玩家可见信息的纯函数：progress（目标进度）、weekSummary（回合小结）、historyOf（历史回看）
│   ├── ui/            # 界面层
│   │   ├── save.js        # localStorage 自动存档（单槽，无手动读档）
│   │   ├── view.js        # 纯渲染（state + ui → DOM）
│   │   ├── replay.js      # 结束回合后 5 根日 K 逐根回放（约 2 秒）
│   │   ├── tips.js        # 悬停说明 ⓘ（GameTips.tip）：文案由调用方从 config 读数值拼入，不要写死数字
│   │   ├── weekly.js      # 回合小结弹窗（盈亏/费用/成交/新闻）
│   │   ├── history.js     # 回合历史：切换查看任意回合的新闻、研究与结果
│   │   ├── rules.js       # 规则说明页（数值全部读 config，首次启动自动弹出，顶部"规则"按钮可再开）
│   │   └── review.js      # 结算后的复盘页（自绘 SVG：K 线 + 真实价值 V + 事件/买卖/研究标记）
│   ├── app.js         # 控制器：事件委托 → 调用 game/ 纯函数 → 存档/回放
│   └── chart.js       # lightweight-charts 封装（K 线 + MA/BOLL + 成交量 + MACD + RSI/KDJ）
├── scripts/simulate.js    # 平衡测试（Node，无 DOM）
├── tests/game.test.js     # 单元测试（node:test）
├── docs/windows-验证清单.md   # 只在 Linux 验证过的桌面功能，需在 Windows 上手动确认
└── icons/ dist/
```

脚本加载顺序（index.html）：`lightweight-charts` → `game/config` → `rng` → `companies` → `events` → `scoring` → `market` → `research` → `trading` → `game-state` → `record` → `summary` → `chart` → `ui/tips` → `ui/save` → `ui/view` → `ui/replay` → `ui/review` → `ui/weekly` → `ui/history` → `ui/rules` → `app`。所有模块是 UMD/IIFE，通过全局变量互相引用（`GameConfig`、`GameRng`、`GameState`、`ChartManager`、`App` 等）。

### 遗留文件（仍在仓库，但 index.html 不加载）

`js/patterns.js`、`js/tutorial-content.js`、`js/tutorial-ui.js`：旧版实时模拟器的 K 线形态识别与教程，**尚未适配新游戏**。已删除的旧代码（`simulator.js`、`trader.js`、`save-manager.js`、`backtest.js`、`ordertypes.js` 等）都可在 `archive/simulator` 分支找到。不要在新代码里引用遗留文件。

## 关键实现细节

### 价格模型（market.js）
- `P = V · exp(s + ε)`；情绪每日 `s_next = κ·s + η`（κ=0.96，向 0 回归）；ε 为当日噪声。
- V 按增长率 + 扩散（扩散 ×(1+负债)）演化；事件在周内第 1 日起作用：`V *= exp(vLog)`，`s += sShift`。事件对 V 的冲击 ×(1+负债水平)。
- 收盘价 = 目标价，受 ±10% 涨跌停约束；开盘价承接上一日未完成的变动（`openCarry`），所以大事件会形成连续涨停。
- 随机流：`rng.setup`（salt 4，公司参数与开局偏离）只在 `newGame` 使用一次，不影响价格路径。
- 玩家的"edge"来源：价格对 V 的偏离（即 s）会回归；研究让玩家估出 V，从而估出 s。

### 纯函数与随机流（game-state.js）
- `advanceTurn(state, actions)` 不修改入参，返回新 state。`actions = { research?: [{id, points}], orders?: [{id, side, shares}] }`。
- state 里有 3 条独立随机流（`rng.market/events/research`，各存一个 uint32）：**玩家行动不改变价格路径**，同一种子下不同玩家/bot 面对完全相同的市场，可做配对比较。
- state 含隐藏真相（`companies[id].V` 等）。UI 与 bot 不得读取它们（结算界面除外）；bot 只用 `candles`、`cash`、`positions`、`Research.getEstimate()`。
- state 里除了当前状态，还记录复盘用的真相：`vPath`（真实价值 V 的逐日路径，与 `candles` 对齐）、`tradeLog`、`researchLog`（含研究当时的真实 V）、`eventLog`（含新闻文本与真实效果）。这些在游戏结束前绝不能展示；复盘页（`ui/review.js`）只在结算后读取。
- 研究在 UI 中是即时操作（`GameResearch.research(state, id, points)` → 新 state），好让玩家看到估值后再下单；研究后立即存档，防止读档重抽。

### 试玩记录（record.js / app.js）
- 记录 = 种子 + 每回合 `{research, orders}`（与 `advanceTurn` 的 actions 同格式）+ 耗时 + 结果；`Record.replay(rec)` 重放得到与实际完全一致的结局（有测试覆盖，改规则代码时别破坏这一点：不要在 advanceTurn 里引入不可重放的状态）。
- 记录里有 `gameVersion`（来自 `config.gameVersion`，当前 `v0.1-playtest`，也显示在界面右下角）。**发新一批试玩版本前要改这个值**，这样收回来的数据能区分版本。
- 耗时由 `app.js` 测量（回合界面停留的累计毫秒，刷新后继续累计），传给 `commitTurn`。存档格式为 `{state, record}`；`state.version` 不符的旧存档直接丢弃。

### 即时反馈（summary.js / weekly.js / history.js）
- 顶部评分条：当前总分、预估等级、本季度目前得分、距下一等级还差多少分（等级尺 D|C|B|A|S 带当前位置），下面是收益率 vs 基准、最大回撤（超阈值开始扣分）、四个季度的得分。全部由 `GameSummary.progress` 计算，数值读 config。季度成绩单与结算页展示分数构成明细。
- 回合小结、回合历史只能使用玩家本来能看到的信息：`candles`、`tradeLog`、`researchLog` 的 estimate/sigma、`eventLog` 的 headline。**禁止**读取 `vPath`、`trueV`、事件的 `kind`/`effects`；测试里有"小结不含真实价值"的检查。
- 估值一律显示为"估值 ¥X + 区间条（约 68% 把握在此区间内）"，区间 = 估值·e^∓σ；不再写"±5%"（σ 是标准差，不是硬边界）。公司列表里"最近一日"（最后一个交易日涨跌）与"近一周"（5 日累计，与小结"本周累计涨跌"同口径）分开标注。
- 回合小结带"本周回撤"：周内总资产相对历史最高点最深回落（回撤按每日总资产算，周中跌得更深也计入，所以赚钱的一周最大回撤也可能变大）。估值只剩最后 1 回合有效时橙色提醒；结算页的"研究估值"列和**研究当时**的真实价值比较（不是和期末价值比），并标注是否已过期。
- 图表标题：主图均线图例、成交量、MACD、RSI（TradingView 水印是 lightweight-charts 的署名要求，保留）。
- 主图买卖标记与成本线：`ChartManager.setTradeOverlay`，只用初始化时创建的 candleSeries。

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

## 平衡验收标准（simulate.js 内置检查，1000 局）

1. 研究 bot 平均收益率高于所有其他 bot，且相对随机估值 bot（交易逻辑相同、估值是随机数）的配对差 ≥ 5 个百分点。
2. 任何"押单一公司"bot 的平均收益率都不显著高于等权持有（配对差 < 2 倍标准误）——不存在固定最优股票。
3. 所有"押单一公司"bot 胜率 ≤ 10%。
4. 所有"躺平"bot（随机全仓一家，收益达到 +25%/+30%/+40% 后清仓持现金到结束）胜率 ≤ 10%。
5. 研究 bot 胜率在 35%–60%；等权持有、随机交易、随机估值 bot 的胜率都 ≤ 15%。

## 修改参数的流程

X、Y、Z（`winMarginPct`/`winMaxDrawdown`/`winMinQuarters`）三者共同决定各 bot 的胜率，必须一起调；调参用一次完整模拟收集逐局数据，再离线扫网格最省时间。所有数值在 `js/game/config.js`（公司固定属性在 `companies.js`，事件数值在 `events.js` 的 `CARDS`）。改完运行 `npm test` 和 `node scripts/simulate.js`，确认验收仍全部通过，并在提交信息里写明改了什么、为什么。调参只改 config；不要为了过验收去改规则代码。
