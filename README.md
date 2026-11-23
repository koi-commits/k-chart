# K线策略游戏（v0 原型）

一个回合制的股市策略游戏。你从 10 万本金的散户起步，在 20 个回合（每回合一周）里，靠**研究、判断和资金管理**赚钱。

核心原则是"决策有因果"：赢要靠研究和判断，不能靠运气猜涨跌。

## 玩法

- 市场里有 4 家虚构公司：金樽酒业（白酒）、光储新能（新能源）、华岳地产（地产）、芯海科技（半导体）。每局它们的增长率、波动率、负债水平都是随机的，所以没有"永远该买"的股票。
- 每家公司都有你看不到的**真实价值**。股价 = 真实价值 × exp(市场情绪 + 噪声)，情绪会逐渐回归，所以股价总会被"拉回"真实价值附近。
- 每回合有 **3 个研究点**。给某家公司投入研究点，会得到它真实价值的**估计值**：投入越多误差越小；估值 4 回合后过期。
- 估值低于股价 → 可能被高估；高于股价 → 可能被低估。结合新闻线索判断：价格波动是公司基本面变了，还是只是情绪。
- 下的订单在**下周一开盘价**成交。规则贴近 A 股：佣金/印花税/过户费、T+1、涨停买不进、跌停卖不出、大单有市场冲击。
- 点"结束回合"，本周 5 根日 K 会快速回放。
- 第 20 回合结束，或总资产跌破 ¥30,000 时游戏结束，结算总资产、收益率、最大回撤，并揭晓每家公司的真实价值。
- **胜利条件**：打完 20 回合，且收益率比"开局平均买入 4 家并一直持有"的基准高出 20 个百分点以上。
- 进度自动存档，下次启动自动继续（没有手动读档）。

## 运行

需要 Node.js 与 npm。

```bash
npm install     # 首次：安装 electron 与 lightweight-charts
npm start       # 运行游戏
```

测试与平衡测试（不需要 electron，只需要 node）：

```bash
npm test                            # 单元测试
node scripts/simulate.js            # 8 个 bot 各 1000 局，并输出验收结果
node scripts/simulate.js 200 7      # 200 局，种子从 7 开始
```

构建 Windows 便携版（输出到 `dist/`；国内网络先设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）：

```bash
npm run build
```

## 目录结构

```
main.js, preload.js      Electron 入口
index.html, css/         界面
lib/                     lightweight-charts v4.2 (UMD)
js/game/                 游戏核心（纯逻辑，浏览器与 Node 通用）
  config.js                所有数值参数
  rng.js                   可设种子随机数
  companies.js             公司与隐藏属性
  events.js                10 张事件卡
  market.js                价格模型与日 K 生成
  research.js              研究点与估值
  trading.js               费率 / 冲击 / T+1 / 涨跌停
  game-state.js            advanceTurn(state, actions) -> newState
js/ui/                   存档、渲染、回放
js/app.js                界面控制器
js/chart.js              K 线图表封装
scripts/simulate.js      平衡测试
tests/                   单元测试
```

原版实时 K 线模拟器保存在 `archive/simulator` 分支。更多开发说明见 [CLAUDE.md](CLAUDE.md)。
