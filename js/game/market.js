/* ============================================
   market.js — 价格模型 P = V · exp(s + ε)
   · 情绪 s 每日 s_next = κ·s + η（κ<1，向 0 回归）
   · V 按增长率 + 扩散演化，事件在周内第 1 日起作用
   · ε 为当日噪声；收盘价 = 目标价，受 ±10% 涨跌停约束
   · 每回合（一周）生成 5 根日 K（OHLC 构建参考 simulator.js）
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
  else root.GameMarket = factory(root.GameConfig);
})(typeof self !== 'undefined' ? self : this, function (GameConfig) {

  const r2 = (x) => Math.round(x * 100) / 100;
  const M = GameConfig.market;

  function limitPrices(prevClose) {
    return { up: r2(prevClose * (1 + GameConfig.limitPct)), down: r2(prevClose * (1 - GameConfig.limitPct)) };
  }
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  /** s 的平稳分布标准差：σ_η / √(1-κ²) */
  function sentimentStd() { return M.sigmaSentiment / Math.sqrt(1 - M.kappa * M.kappa); }

  /** 周序号（可为负，表示开局前的历史）+ 周内第几天 → UTC 秒时间戳 */
  function dayTime(weekIndex, d) {
    return Math.floor(GameConfig.startDate / 1000) + (weekIndex * 7 + d) * 86400;
  }

  /**
   * 生成一周 5 根日 K，并返回更新后的 V、s、收盘与目标价。
   * @param co    { V, s, growth, vol, debt, adv }（不修改入参）
   * @param carry { prevClose, prevTarget }
   * @param effect 可选 { vLog, sShift }：周内第 1 日开始时结算
   */
  function simulateWeek(co, carry, weekIndex, effect, rng) {
    let V = co.V, s = co.s;
    let prevClose = carry.prevClose, prevTarget = carry.prevTarget;
    const sigmaV = M.valueDiffusion * (1 + co.debt);
    const candles = [];

    for (let d = 0; d < GameConfig.daysPerTurn; d++) {
      if (d === 0 && effect) { V *= Math.exp(effect.vLog); s += effect.sShift; }
      s = M.kappa * s + M.sigmaSentiment * rng.normal();                       // 情绪回归
      V *= Math.exp(co.growth / M.tradingDaysPerYear - 0.5 * sigmaV * sigmaV + sigmaV * rng.normal());
      const eps = co.vol * rng.normal();
      const target = V * Math.exp(s + eps);

      const lim = limitPrices(prevClose);
      // 开盘：承接上一日未完成的变动（涨跌停时形成惯性）+ 跳空噪声
      const open = r2(clamp(prevClose * Math.exp(M.openCarry * Math.log(prevTarget / prevClose) + M.openGapSigma * rng.normal()), lim.down, lim.up));
      const close = r2(clamp(target, lim.down, lim.up));

      const intraVol = co.vol * M.rangeScale;
      let high = r2(clamp(Math.max(open, close) * (1 + intraVol * rng.exponential(M.rangeRate)), lim.down, lim.up));
      let low = r2(clamp(Math.min(open, close) * (1 - intraVol * rng.exponential(M.rangeRate)), lim.down, lim.up));
      high = Math.max(high, open, close);
      low = Math.min(low, open, close);

      const ret = Math.abs(Math.log(close / prevClose));
      const volume = Math.floor(co.adv * rng.uniform(M.volumeJitter[0], M.volumeJitter[1]) * (1 + ret * M.volumeReturnGain));

      candles.push({ time: dayTime(weekIndex, d), open, high, low, close, volume });
      prevClose = close; prevTarget = target;
    }
    return { candles, V, s, prevClose, prevTarget };
  }

  return { simulateWeek, limitPrices, sentimentStd, dayTime };
});
