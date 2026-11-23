/* ============================================
   record.js — 试玩记录（纯函数，不碰 DOM / 时钟）
   记录：种子、每回合的行动（研究分配 + 订单）与耗时、最终结果。
   行动按 advanceTurn 的 actions 格式保存，所以 replay(record) 能按种子逐回合重放出完全相同的结局。
   耗时由界面层测量后传入（毫秒）。
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'), require('./game-state.js'));
  else root.GameRecord = factory(root.GameConfig, root.GameState);
})(typeof self !== 'undefined' ? self : this, function (GameConfig, GameState) {

  /** 新记录；startedAt 由调用方传入（ISO 字符串） */
  function create(seed, startedAt, restartCount) {
    return {
      format: 'kline-game-record', version: 1,
      gameVersion: GameConfig.gameVersion,
      restartCount: restartCount || 0,   // 同一存档期间点击"重新开始"的累计次数（再来一局不计，只沿用）
      seed, startedAt, endedAt: null,
      rules: { totalTurns: GameConfig.totalTurns, quarters: GameConfig.quarters, quarterLength: GameConfig.quarterLength, scoring: GameConfig.scoring },
      turns: [],
      pending: { turn: 1, accMs: 0, research: [] },   // 当前未结束回合的进行中数据（随存档保存，刷新后可继续）
      result: null, truth: null
    };
  }

  /** 结束一个回合：把 pending 里的研究 + 订单 + 耗时归档。state 为回合结束后的新 state。 */
  function commitTurn(rec, args) {
    const lw = args.state.lastWeek;
    rec.turns.push({
      turn: args.turn,
      durationMs: Math.round(args.durationMs),
      news: args.newsShown,
      research: rec.pending.research.slice(),
      orders: args.orders.map((o) => ({ id: o.id, side: o.side, shares: o.shares })),
      trades: lw.trades, failed: lw.failed.map((f) => ({ id: f.order.id, side: f.order.side, shares: f.order.shares, error: f.error })),
      assetsAfter: args.state.equity[args.state.equity.length - 1].assets
    });
    rec.pending = { turn: args.state.turn, accMs: 0, research: [] };
    if (args.state.status === 'ended') finalize(rec, args.state, args.endedAt);
    return rec;
  }

  function finalize(rec, state, endedAt) {
    rec.endedAt = endedAt || null;
    rec.result = state.result;
    rec.truth = Object.keys(state.companies).map((id) => {
      const c = state.companies[id];
      return { id, name: c.name, industry: c.industry, growth: c.growth, vol: c.vol, debt: c.debt, finalV: Math.round(c.V * 100) / 100 };
    });
    rec.events = state.eventLog;
    return rec;
  }

  /** 按记录重放，返回最终 state（用于校验记录与结果一致） */
  function replay(rec) {
    let s = GameState.newGame(rec.seed);
    for (const t of rec.turns) {
      s = GameState.advanceTurn(s, {
        research: t.research.map((r) => ({ id: r.id, points: r.points })),
        orders: t.orders
      });
    }
    return s;
  }

  return { create, commitTurn, finalize, replay };
});
