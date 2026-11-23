/* ============================================
   summary.js — 玩家可见信息的纯函数汇总（不碰 DOM、不读隐藏真相）
   · progress(state, upto)    目标进度：收益率 vs 基准+目标、最大回撤 vs 上限
   · weekSummary(state, turn) 第 turn 回合的小结：盈亏（总/按公司）、费用、新闻、未成交
   · historyOf(state, turn)   第 turn 回合开始时玩家看到的新闻与自己的研究
   只使用 candles / tradeLog / researchLog / equity / eventLog 里的 headline，
   绝不返回真实价值 V，也不返回事件是基本面还是情绪。
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'), require('./game-state.js'));
  else root.GameSummary = factory(root.GameConfig, root.GameState);
})(typeof self !== 'undefined' ? self : this, function (GameConfig, GameState) {

  const ids = (s) => Object.keys(s.companies);
  const warmDays = () => GameConfig.warmupWeeks * GameConfig.daysPerTurn;
  /** 回合 t（1 起）第 1 个交易日在 candles 里的下标 */
  const turnStartIdx = (t) => warmDays() + (t - 1) * GameConfig.daysPerTurn;
  const round2 = (x) => Math.round(x * 100) / 100;

  /**
   * 目标进度。upto = 参与计算的 K 线根数（回放时逐日增加；缺省 = 全部）。
   * 胜利条件：收益率 ≥ 基准 + winMarginPct 且 最大回撤 < winMaxDrawdown（打完全部回合时判定）。
   */
  function progress(state, upto) {
    const n = upto == null ? state.candles[ids(state)[0]].length : upto;
    let assets = state.cash;
    for (const id of Object.keys(state.positions)) assets += state.positions[id].shares * state.candles[id][n - 1].close;
    const eq = state.equity.slice(0, Math.max(1, 1 + n - warmDays()));
    let peak = -Infinity;
    for (const e of eq) peak = Math.max(peak, e.assets);
    const last = eq[eq.length - 1].assets;
    const maxDD = GameState.maxDrawdown(eq);
    let bench = 0;
    if (state.benchStart) {
      bench = (ids(state).reduce((a, id) => a + state.candles[id][n - 1].close / state.benchStart[id] - 1, 0) / ids(state).length) * 100;
    }
    // 季度进度（按已过交易日 d；回放时随 upto 变化）
    const d = Math.max(0, n - warmDays());
    const Q = GameConfig.quarters, qd = GameConfig.quarterLength * GameConfig.daysPerTurn;
    const done = GameState.quarterResults(state, d);
    const beaten = done.filter((x) => x.beat).length;
    const qNow = Math.min(Q, Math.floor(d / qd) + 1);                      // 当前（或最后）季度
    const cur = d >= Q * qd ? done[Q - 1] : GameState.quarterAt(state, qNow, d);
    const turnNow = Math.min(GameConfig.totalTurns, Math.floor(d / GameConfig.daysPerTurn) + 1);
    const quarter = {
      q: qNow, turnInQuarter: ((turnNow - 1) % GameConfig.quarterLength) + 1, length: GameConfig.quarterLength,
      diff: cur.diff, playerPct: cur.playerPct, benchPct: cur.benchPct,
      completed: done.length, beaten, total: Q, need: GameConfig.winMinQuarters,
      // 还没结束的季度（含当前）全部跑赢也凑不够 → 已无法满足季度条件
      impossible: beaten + (Q - done.length) < GameConfig.winMinQuarters,
      pills: Array.from({ length: Q }, (_, i) => (i < done.length ? (done[i].beat ? 'beat' : 'miss') : i === done.length ? 'cur' : 'future'))
    };
    const limit = GameConfig.winMaxDrawdown;
    const warnAt = limit * 0.75;                       // 达到上限的 75%（20% → 15%）开始醒目提示
    return {
      assets, returnPct: (assets / GameConfig.initialCash - 1) * 100,
      benchPct: bench, targetPct: bench + GameConfig.winMarginPct,
      maxDD, curDD: peak > 0 ? Math.max(0, (peak - last) / peak) : 0,
      ddLimit: limit, ddWarnAt: warnAt,
      ddLevel: maxDD >= limit ? 'over' : maxDD >= warnAt ? 'warn' : 'ok',
      returnReached: (assets / GameConfig.initialCash - 1) * 100 >= bench + GameConfig.winMarginPct,
      quarter
    };
  }

  /**
   * 研究之后出现的、与该公司（或其所在行业）有关的新闻。
   * 第 t 回合做的研究发生在第 t 周事件之前，所以 turn ≥ 研究回合的事件都算"研究之后"。
   * 只返回回合与新闻标题：不含方向、幅度，也不判断估值是否仍然有效。
   */
  function newsSinceResearch(state, id) {
    const r = state.research[id];
    if (!r) return [];
    return state.eventLog.filter((e) => e.turn >= r.turn && e.effects[id]).map((e) => ({ turn: e.turn, headline: e.headline }));
  }

  /** 回合开始时玩家看到的新闻 = 上一周（turn-1）发生的事件标题；第 1 回合是开局提示 */
  function newsAtStart(state, turn) {
    if (turn <= 1) return ['新赛季开始，市场暂无重大消息。'];
    const h = state.eventLog.filter((e) => e.turn === turn - 1).map((e) => e.headline);
    return h.length ? h : ['本周市场平静，没有重大消息。'];
  }

  /**
   * 第 turn 回合（必须已结束）的小结。
   * 每家公司盈亏 = 期末持仓市值 − 期初持仓市值 + 卖出所得 − 买入花费 − 手续费，
   * 各公司之和 = 本周总资产变化。
   */
  function weekSummary(state, turn) {
    const i0 = turnStartIdx(turn), i1 = i0 + GameConfig.daysPerTurn - 1;
    const trades = state.tradeLog.filter((t) => t.turn === turn);
    const before = state.tradeLog.filter((t) => t.turn < turn);
    const rows = [];
    let total = 0, fees = 0;
    for (const id of ids(state)) {
      let sh0 = 0;
      for (const t of before) if (t.id === id) sh0 += t.side === 'buy' ? t.shares : -t.shares;
      let flow = 0, sh1 = sh0, fee = 0;
      for (const t of trades) {
        if (t.id !== id) continue;
        flow += (t.side === 'buy' ? -1 : 1) * t.price * t.shares - t.fee;
        sh1 += t.side === 'buy' ? t.shares : -t.shares;
        fee += t.fee;
      }
      const pnl = sh1 * state.candles[id][i1].close - sh0 * state.candles[id][i0 - 1].close + flow;
      const wkChg = state.candles[id][i1].close / state.candles[id][i0 - 1].close - 1;
      rows.push({ id, name: state.companies[id].name, pnl: round2(pnl), fee: round2(fee), sharesEnd: sh1, weekChange: wkChg });
      total += pnl; fees += fee;
    }
    const failed = (state.failedLog || []).filter((f) => f.turn === turn);
    return {
      turn, total: round2(total), fees: round2(fees), rows,
      trades: trades.map((t) => ({ id: t.id, name: state.companies[t.id].name, side: t.side, shares: t.shares, price: t.price, fee: t.fee, requested: t.requested || null })),
      failed: failed.map((f) => ({ id: f.id, name: state.companies[f.id].name, side: f.side, shares: f.shares, error: f.error, partial: !!f.partial })),
      news: state.eventLog.filter((e) => e.turn === turn).map((e) => e.headline),   // 本周发生的新闻（下回合开头会再次显示）
      assetsEnd: state.equity.filter((e) => e.turn === turn).slice(-1)[0].assets
    };
  }

  /** 第 turn 回合开始时的情报：当时看到的新闻 + 这一回合自己做的研究（只含估值，不含真实价值） */
  function historyOf(state, turn) {
    return {
      turn,
      news: newsAtStart(state, turn),
      research: state.researchLog.filter((r) => r.turn === turn).map((r) => ({
        id: r.id, name: state.companies[r.id].name, points: r.points, estimate: r.estimate, sigma: r.sigma
      }))
    };
  }

  return { progress, weekSummary, historyOf, newsAtStart, newsSinceResearch, turnStartIdx };
});
