/* ============================================
   config.js — 所有数值参数集中在此
   同时支持浏览器（全局 GameConfig）与 Node（module.exports）
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    // ── 规则 ──
    initialCash: 100000,       // 本金
    totalTurns: 20,            // v0 共 20 回合（每回合 = 一周）
    bankruptcyLine: 30000,     // 回合结束时总资产低于此值判负
    winMultiple: 1.5,          // 统计用：总资产 ≥ 本金 × 1.5 记为"胜"
    daysPerTurn: 5,            // 每回合 5 个交易日
    warmupWeeks: 12,           // 开局前预生成的历史周数（让图表有历史可看）
    lotSize: 100,              // 1 手 = 100 股
    limitPct: 0.10,            // 涨跌停 ±10%
    startDate: Date.UTC(2025, 0, 6), // 第 0 周周一（毫秒）

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
      debtLeverage: 1.0        // 事件对 V 的冲击 × (1 + debtLeverage × 负债水平)
    }
  };
});
