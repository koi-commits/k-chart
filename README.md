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
- **评分与评级**：总分 = 4 个季度分 + 终局分 − 回撤扣分，按总分评 S/A/B/C/D，B 及以上过关。每个季度（5 回合）末有成绩单：你的季度收益率比"开局平均买入 4 家并一直持有"的基准高就得基础分，超额越多越高；终局分按全局超额收益计；最大回撤超过阈值的部分按百分点连续扣分。具体分值见游戏内规则页。
- 进度自动存档，下次启动自动继续（没有手动读档）。
- 结算后可以点"查看复盘"：每家公司一张图，把真实价值画在 K 线上，标出事件、你的买卖和研究估值，一眼看出哪些涨跌是基本面、哪些是情绪。
- 结算后可以点"导出本局记录"，得到一个 JSON 文件（种子、每回合的研究与订单、每回合耗时、结果），用于收集试玩数据。

## 运行（Windows）

> 下面的步骤按 Windows 10/11 + PowerShell 写成。我（开发者）是在 Linux 环境里开发和测试的，**Windows 下的安装与打包步骤尚未在 Windows 机器上实际跑过**，遇到问题请告诉我。

### 方式一：直接运行源码

1. 安装 [Node.js](https://nodejs.org) LTS 版（自带 npm），装完重新打开 PowerShell。
2. 获取代码并切到游戏分支：
   ```powershell
   git clone https://github.com/koi-commits/k-chart.git
   cd k-chart
   git checkout game-v0
   ```
3. **国内网络**：Electron 会在 `npm install` 时下载约 100MB 的程序，必须在安装**之前**设置镜像：
   ```powershell
   $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
   npm config set registry https://registry.npmmirror.com
   ```
   （用 cmd 的话把第一行换成 `set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。）
4. 安装并启动：
   ```powershell
   npm install
   npm start
   ```

游戏以普通窗口（1280×800）启动，有系统标题栏。**F11** 切换全屏，全屏时按 **Esc** 退出全屏；界面右上角有"规则"、"重新开始"、"退出游戏"按钮（退出前会自动存档）。第一次启动会弹出规则说明。

### 方式二：打包成 exe 发给同学

```powershell
npm run build
```

产物是 `dist\K线策略游戏.exe`（便携版，单文件，无需安装）。把这一个文件发给同学，双击即可运行。

- 国内网络同样要先设置上面的 `ELECTRON_MIRROR`（打包也要下载 Electron）。
- exe 没有代码签名，同学第一次打开 Windows 可能弹出 SmartScreen "已保护你的电脑"：点"更多信息" → "仍要运行"。
- 如果打包时报创建符号链接（symbolic link）的权限错误，请用管理员身份运行 PowerShell，或在 Windows 设置里打开"开发者模式"后重试。

### 存档与试玩记录

- 存档自动保存在浏览器本地存储里（Windows 下位于 `%APPDATA%\K线策略游戏\`），每次启动自动继续上一局；点"重新开始"或结算后点"再来一局"会开新局。
- 一局结束后在结算界面点"💾 导出本局记录"，会下载一个 `kline-game-seed<种子>-<时间>.json`。在桌面版里会弹出系统的"另存为"对话框，默认保存到"下载"文件夹；请同学把这个文件发回给你。文件里带有版本号（当前 `v0.1-playtest`，也显示在游戏右下角）。文件里的种子 + 每回合行动可以完整重放这一局。

### 开发与测试（只需要 node，不需要 electron）

```bash
npm test                            # 单元测试
node scripts/simulate.js            # 11 个 bot 各 1000 局，并输出验收结果
node scripts/simulate.js 200 7      # 200 局，种子从 7 开始
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
  record.js                试玩记录与重放
docs/                    Windows 手动验证清单
js/ui/                   存档、渲染、回放、复盘页、规则页
js/app.js                界面控制器
js/chart.js              K 线图表封装
scripts/simulate.js      平衡测试
tests/                   单元测试
```

原版实时 K 线模拟器保存在 `archive/simulator` 分支。更多开发说明见 [CLAUDE.md](CLAUDE.md)。
