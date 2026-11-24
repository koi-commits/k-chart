/* ============================================
   config.js — 所有数值参数集中在此
   同时支持浏览器（全局 GameConfig）与 Node（module.exports）
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    // 版本号分两部分（都写入导出的记录）：
    buildVersion: '0.4.3-playtest', // 程序版本：只要修改代码就升级；显示在界面右下角（前面加 v）
    rulesVersion: '0.4.1',          // 规则版本：只有游戏规则或本文件里的数值变化时才升级；存档能否继续、记录能否直接分析都按它判断

    // ── 规则 ──
    initialCash: 100000,       // 本金
    totalTurns: 20,            // v0 共 20 回合（每回合 = 一周）
    bankruptcyLine: 30000,     // 回合结束时总资产低于此值判负
    quarters: 4,               // 20 回合分为 4 个季度
    quarterLength: 5,          // 每季度 5 回合（quarters × quarterLength = totalTurns）

    // ── 评分系统（取代原来的三条硬性胜利条件）──
    // 总分 = 4 个季度分 + 终局分 − 回撤扣分（总分有下限）；按总分评 S/A/B/C/D，B 及以上视为过关。
    // 超额收益 = 玩家收益率 − 等权基准收益率，单位：百分点。
    scoring: {
      quarter: {            // 季度分：跑赢基准得基础分，超额部分每个百分点再加分；单季度得分设上下限
        beatBase: 3,        //   本季度超额 > 0 时的基础分
        perPoint: 0.35,     //   每个百分点超额的分数（超额为负时同样按此扣分）
        min: -7, max: 13    //   单季度得分下限/上限（防止一个季度决定整局）
      },
      final: {              // 终局分：按全局超额收益计分
        perPoint: 0.75,     //   每个百分点全局超额的分数
        min: -9, max: 15    //   终局分下限/上限
      },
      drawdown: {           // 回撤扣分（超额回撤）：玩家总资产 ÷ 等权基准净值 这条相对曲线，按每周收盘从历史最高点回落的最大幅度；
                            // 超过阈值的部分按百分点连续扣分，扣分有上限。大盘下跌时比基准少跌不算回撤
        threshold: 0.09,    //   阈值（0.09 = 9%）
        perPoint: 2.5,      //   超出阈值的每个百分点扣多少分
        maxPenalty: 25      //   回撤扣分上限
      },
      totalMin: -10,        // 总分下限（防止出现 −55 这样的分数）
      // 等级线按研究 bot 的总分分布定标（种子 1–1000）：B ≈ 研究 bot 的中位数附近（约 45% 的局 ≥ B），A ≈ 前 20%，S ≈ 前 5%
      grades: { S: 40, A: 34, B: 26.3, C: 5 }   // 总分 ≥ 该线评为对应等级，低于 C 线为 D
    },
    daysPerTurn: 5,            // 每回合 5 个交易日
    warmupWeeks: 12,           // 开局前预生成的历史周数（让图表有历史可看）
    lotSize: 100,              // 1 手 = 100 股
    limitPct: 0.10,            // 涨跌停 ±10%
    startDate: Date.UTC(2025, 0, 6), // 第 0 周周一（毫秒）

    // ── 公司参数（每局由种子在各行业范围内随机生成）──
    // 范围刻意重叠，且各行业 growth 区间中点相同（均为 0.08），只是宽度不同（白酒稳、新能源/半导体宽）：
    // 这样没有"平均更好的行业"，不存在固定的最优股票。growth/vol/debt 为 [min, max]；v0 为初始真实价值的基准价区间
    industries: {
      liquor:     { growth: [0.00, 0.16], vol: [0.008, 0.016], debt: [0.05, 0.40], v0: [80, 160] },
      newenergy:  { growth: [-0.15, 0.31], vol: [0.012, 0.024], debt: [0.20, 0.70], v0: [25, 70] },
      realestate: { growth: [-0.10, 0.26], vol: [0.010, 0.022], debt: [0.50, 0.95], v0: [10, 30] },
      semi:       { growth: [-0.12, 0.28], vol: [0.014, 0.026], debt: [0.15, 0.60], v0: [40, 110] }
    },
    startSentimentStd: 0.10,   // 开局情绪 s 的标准差（= 开局价格与真实价值的偏离，约等于平稳分布）
    startValueJitter: 0.08,    // 开局真实价值相对 v0 的对数抖动

    // ── A 股费率（来自 trader.js）──
    fees: {
      commissionRate: 0.00025, // 佣金万 2.5
      minCommission: 5,        // 最低 ¥5
      stampDutyRate: 0.001,    // 印花税千 1（仅卖出）
      transferFeeRate: 0.00002 // 过户费万 0.2
    },

    // ── 市场冲击（平方根模型 + 五档盘口，确定性版本）──
    impact: {
      sqrtCoef: 0.5,           // 平方根冲击系数
      levelStep: 0.001,        // 每档价差 0.1%
      levelDepthFractions: [0.002, 0.004, 0.008, 0.016, 0.03], // 每档深度 = 日均成交量 × 比例
      overflowExtra: 0.01      // 超出五档部分的额外滑点
    },

    // ── 价格模型  P = V * exp(s + ε) ──
    market: {
      kappa: 0.96,             // 情绪每日衰减系数 s_next = κ·s + η
      sigmaSentiment: 0.03,    // η 的日标准差
      valueDiffusion: 0.004,   // V 的日扩散（会乘以 1+debt）
      openGapSigma: 0.004,     // 开盘跳空噪声
      openCarry: 0.5,          // 开盘承接上一日未完成的价格变动（涨跌停后的惯性）
      rangeScale: 0.6,         // 日内高低点幅度 = vol × 此值 × Exp(rate)
      rangeRate: 1.5,
      volumeJitter: [0.6, 1.4],
      volumeReturnGain: 15,    // 量价联动：成交量 × (1 + |ret| × 此值)
      tradingDaysPerYear: 252
    },

    // ── 研究 ──
    research: {
      pointsPerTurn: 3,        // 每回合研究点
      baseError: 0.18,         // 投入 1 点时 ln(V) 估计误差的标准差
      errorDecay: 0.55,        // 每多投 1 点，误差乘以此系数
      validTurns: 4            // 信息有效回合数（第 t 回合研究，t+3 回合仍有效）
    },

    // ── 事件 ──
    events: {
      firstProb: 0.7,          // 每周至少 1 个事件的概率
      secondProb: 0.2,         // 额外再发生 1 个事件的概率
      debtLeverage: 1.0,       // 事件对 V 的冲击 × (1 + debtLeverage × 负债水平)
      // 新闻标题的轻/重措辞：按"最终作用在公司上的实际影响"用统一的绝对阈值划分（只影响措辞，不影响幅度和随机数）
      //   基本面：乘负债杠杆之后的 |vLog| < strongVLog 为轻。0.06 ≈ 普通一周的价格波动（每周 |对数收益| 中位数约 0.055）：
      //           真实价值的变化不超过一周的正常波动，才能说"小幅""影响有限"
      //   情绪：|sShift| < strongShift 为轻。情绪会按 κ 每日回归，0.07 × 0.96^5 ≈ 0.057：一周后剩下的部分不超过一周的正常波动
      //   行业事件影响多家公司时，按受影响最大的那家决定措辞（保证"小幅/影响有限"不会低估任何一家）
      headline: { strongVLog: 0.06, strongShift: 0.07 }
    }
  };
});
