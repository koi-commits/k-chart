/* ============================================
   summary.js — 玩家可见信息的纯函数汇总（不碰 DOM、不读隐藏真相）
   · progress(state, upto)    目标进度：收益率 vs 基准+目标、最大回撤 vs 上限
   · weekSummary(state, turn) 第 turn 回合的小结：盈亏（总/按公司）、费用、新闻、未成交
   · historyOf(state, turn)   第 turn 回合开始时玩家看到的新闻与自己的研究
   只使用 candles / tradeLog / researchLog / equity / eventLog 里的 headline，
   绝不返回真实价值 V，也不返回事件是基本面还是情绪。
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'), require('./game-state.js'), require('./scoring.js'));
  else root.GameSummary = factory(root.GameConfig, root.GameState, root.GameScoring);
})(typeof self !== 'undefined' ? self : this, function (GameConfig, GameState, GameScoring) {

  const ids = (s) => Object.keys(s.companies);
  const warmDays = () => GameConfig.warmupWeeks * GameConfig.daysPerTurn;
  /** 回合 t（1 起）第 1 个交易日在 candles 里的下标 */
  const turnStartIdx = (t) => warmDays() + (t - 1) * GameConfig.daysPerTurn;
  const round2 = (x) => Math.round(x * 100) / 100;

  /**
   * 目标进度。upto = 参与计算的 K 线根数（回放时逐日增加；缺省 = 全部）。
   * 评分：总分 = 季度分 + 终局分 − 回撤扣分（见 scoring.js）；这里给出"若现在结束"的得分与预估等级。
   */
  function progress(state, upto) {
    const n = upto == null ? state.candles[ids(state)[0]].length : upto;
    let assets = state.cash;
    for (const id of Object.keys(state.positions)) assets += state.positions[id].shares * state.candles[id][n - 1].close;
    const dInfo = GameState.excessDrawdownInfo(state, Math.max(0, n - warmDays()));   // 超额回撤（相对基准、按周收盘）
    const eq = state.equity.slice(0, Math.max(1, 1 + n - warmDays()));
    let bench = 0;
    if (state.benchStart) {
      bench = (ids(state).reduce((a, id) => a + state.candles[id][n - 1].close / state.benchStart[id] - 1, 0) / ids(state).length) * 100;
    }
    // 评分与季度进度（按已过交易日 d；回放时随 upto 变化）
    const d = Math.max(0, n - warmDays());
    const Q = GameConfig.quarters, qd = GameConfig.quarterLength * GameConfig.daysPerTurn;
    const done = GameState.quarterResults(state, d);
    const sc = GameState.scoreSnapshot(state, d);                          // 假设现在结束的得分
    const qNow = Math.min(Q, Math.floor(d / qd) + 1);                      // 当前（或最后）季度
    const cur = d >= Q * qd ? done[Q - 1] : GameState.quarterAt(state, qNow, d);
    const turnNow = Math.min(GameConfig.totalTurns, Math.floor(d / GameConfig.daysPerTurn) + 1);
    const quarter = {
      q: qNow, turnInQuarter: ((turnNow - 1) % GameConfig.quarterLength) + 1, length: GameConfig.quarterLength,
      diff: cur.diff, playerPct: cur.playerPct, benchPct: cur.benchPct,
      score: GameScoring.quarterScore(cur.diff).score,                     // 本季度目前得分（进行中则为"若现在结束"）
      completed: done.length, total: Q,
      pills: Array.from({ length: Q }, (_, i) => ({
        state: i < done.length ? 'done' : i === done.length ? 'cur' : 'future',
        score: sc.quarters[i] ? sc.quarters[i].score : (i === done.length ? GameScoring.quarterScore(cur.diff).score : null)
      }))
    };
    const dd = GameScoring.drawdownPenalty(dInfo.max);
    // 本季度目标：超额 > 0 拿基础分；超额达到 (上限 − 基础分)/每点分数 即拿满
    const QC = GameConfig.scoring.quarter;
    Object.assign(quarter, {
      scoreMax: QC.max, scoreMin: QC.min, beatBase: QC.beatBase,
      limit: quarter.score >= QC.max ? 'max' : quarter.score <= QC.min ? 'min' : null,
      targetCap: QC.perPoint > 0 ? (QC.max - QC.beatBase) / QC.perPoint : null,   // 拿满所需的超额（百分点）
      gapToBase: Math.max(0, -cur.diff),
      gapToCap: QC.perPoint > 0 ? Math.max(0, (QC.max - QC.beatBase) / QC.perPoint - cur.diff) : null
    });
    // 剩余回合理论上还能再拿多少分（剩余季度与终局都拿上限）；距下一等级太远时界面不再显示"还差 X 分"
    const doneScores = done.map((x) => GameScoring.quarterScore(x.diff).score);
    const room = Math.max(0, GameScoring.bestPossible(doneScores, dInfo.max) - sc.total);
    const next = GameScoring.nextGrade(sc.total);
    return {
      started: d > 0, room, nextTooFar: !!(next && next.need > room / 2),
      assets, returnPct: (assets / GameConfig.initialCash - 1) * 100, benchPct: bench,
      maxDD: dInfo.max, curDD: dInfo.cur, absMaxDD: GameState.maxDrawdown(eq),
      ddThreshold: GameConfig.scoring.drawdown.threshold, ddPenalty: dd.penalty, ddCapped: dd.capped,
      score: { total: sc.total, grade: sc.grade, pass: sc.pass, next: GameScoring.nextGrade(sc.total),
        quarterTotal: sc.quarterTotal, final: sc.final.score, finalExcess: sc.final.excess, penalty: sc.drawdown.penalty },
      quarter
    };
  }

  /** 季度成绩单里解释"为什么赚钱却扣分 / 亏钱却加分"的一句话：只用本季度的绝对收益率与基准收益率 */
  function quarterNote(playerPct, benchPct) {
    const f = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';
    const diff = playerPct - benchPct, ad = Math.abs(diff).toFixed(2);
    const you = playerPct >= 0 ? `你赚了 ${f(playerPct)}` : `你亏了 ${f(playerPct)}`;
    const bm = benchPct >= 0 ? `基准赚了 ${f(benchPct)}` : `基准亏了 ${f(benchPct)}`;
    if (diff > 0) return playerPct < 0
      ? `${you}，但${bm}，你比基准少亏了 ${ad} 点，所以仍然拿到基础分：评分只看相对基准，不看绝对盈亏。`
      : `${you}，${bm}，比基准多赚 ${ad} 点，拿到基础分与超额加分。`;
    if (diff < 0) return playerPct > 0
      ? `${you}，但${bm}，比基准少赚 ${ad} 点，所以本季度没有基础分、还会被扣分：评分只看相对基准，不看绝对盈亏。`
      : `${you}，${bm}，比基准多亏 ${ad} 点，没有基础分并被扣分。`;
    return `${you}，与基准完全持平，没有超额。`;
  }

  /**
   * "提前判死"：截至已过 d 个交易日，剩余季度全部拿上限 + 终局分拿上限，是否仍达不到 B。
   * 只用于模拟/统计，界面不展示（不提示"已无法过关"）。
   */
  function outlook(state, d) {
    if (d == null) d = state.equity.length - 1;
    const done = GameState.quarterResults(state, d).map((x) => GameScoring.quarterScore(x.diff).score);
    const maxDD = GameState.excessDrawdown(state, d);
    return { best: GameScoring.bestPossible(done, maxDD), dead: GameScoring.isDead(done, maxDD) };
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
    // 超额回撤（相对基准净值，按周收盘）：本周末相对最高点回落多少，以及截至周末的最大超额回撤
    const dEnd = turn * GameConfig.daysPerTurn, dInfo = GameState.excessDrawdownInfo(state, dEnd);
    return {
      turn, total: round2(total), fees: round2(fees), rows, weekDrawdown: dInfo.cur, maxDrawdownSoFar: dInfo.max,
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

  return { progress, outlook, quarterNote, weekSummary, historyOf, newsAtStart, newsSinceResearch, turnStartIdx };
});
