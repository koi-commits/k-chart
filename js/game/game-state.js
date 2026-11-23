/* ============================================
   game-state.js — 单一 state 对象 + 纯函数推进
   核心接口：advanceTurn(state, actions) -> newState
   actions = { research?: [{id, points}], orders?: [{id, side, shares}] }
   流程（一回合 = 一周）：
     1. 结算研究  2. 生成本周 5 根日 K（含事件）
     3. 在本周第 1 日开盘价执行订单（先卖后买，T+1/涨跌停/冲击/费率生效）
     4. 逐日记录总资产  5. 判定结束（第 20 回合完成 或 总资产 < 30000）
   三条独立随机流（market/events/research）：玩家的行动不会改变价格路径，
   同一种子下不同玩家面对完全相同的市场。
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./config.js'), require('./rng.js'), require('./companies.js'),
      require('./market.js'), require('./events.js'), require('./research.js'), require('./trading.js'));
  } else {
    root.GameState = factory(root.GameConfig, root.GameRng, root.GameCompanies,
      root.GameMarket, root.GameEvents, root.GameResearch, root.GameTrading);
  }
})(typeof self !== 'undefined' ? self : this, function (GameConfig, GameRng, GameCompanies, GameMarket, GameEvents, GameResearch, GameTrading) {

  const clone = (o) => JSON.parse(JSON.stringify(o));

  /** 新游戏：生成隐藏属性与 warmupWeeks 周的历史 K 线 */
  function newGame(seed) {
    const rng = {
      market: GameRng.create(GameRng.deriveState(seed, 1)),
      events: GameRng.create(GameRng.deriveState(seed, 2)),
      research: GameRng.create(GameRng.deriveState(seed, 3))
    };
    const setup = GameRng.create(GameRng.deriveState(seed, 4));   // 公司参数专用流，不干扰价格路径
    const companies = {}, candles = {}, carry = {}, vPath = {};
    for (const def of GameCompanies.generate(setup)) {
      const V = def.v0 * Math.exp(GameConfig.startValueJitter * setup.normal());   // 真实价值围绕 v0 抖动
      const s = GameConfig.startSentimentStd * setup.normal();                     // 开局价格与真实价值的偏离
      companies[def.id] = Object.assign({}, def, { V, s });
      delete companies[def.id].v0;
      const p0 = Math.round(V * Math.exp(s) * 100) / 100;
      carry[def.id] = { prevClose: p0, prevTarget: p0 };
      candles[def.id] = []; vPath[def.id] = [];
    }
    // 预热：不发生事件
    for (let w = -GameConfig.warmupWeeks; w < 0; w++) {
      for (const id of Object.keys(companies)) {
        const r = GameMarket.simulateWeek(companies[id], carry[id], w, null, rng.market);
        companies[id].V = r.V; companies[id].s = r.s;
        carry[id] = { prevClose: r.prevClose, prevTarget: r.prevTarget };
        candles[id].push(...r.candles); vPath[id].push(...r.vs);
      }
    }
    return {
      version: 2, seed, turn: 1, status: 'playing', endReason: null,
      cash: GameConfig.initialCash, positions: {},
      companies, candles, carry,
      vPath,                       // 真实价值 V 的逐日路径（与 candles 对齐；仅复盘使用）
      tradeLog: [], researchLog: [],
      research: {}, pointsLeft: GameConfig.research.pointsPerTurn,
      news: [{ cardId: null, headline: '新赛季开始，市场暂无重大消息。' }],
      eventLog: [], lastWeek: null,
      benchStart: null,
      equity: [{ turn: 0, day: 0, assets: GameConfig.initialCash }],
      result: null,
      rng: { market: rng.market.state(), events: rng.events.state(), research: rng.research.state() }
    };
  }

  function lastClose(state, id) {
    const c = state.candles[id];
    return c[c.length - 1].close;
  }

  function totalAssets(state, prices) {
    let v = state.cash;
    for (const id of Object.keys(state.positions)) {
      v += state.positions[id].shares * (prices ? prices[id] : lastClose(state, id));
    }
    return v;
  }

  /** 最大回撤（0~1）：对序列 [本金, 每日总资产...] 计算 */
  function maxDrawdown(equity) {
    let peak = -Infinity, mdd = 0;
    for (const e of equity) {
      peak = Math.max(peak, e.assets);
      if (peak > 0) mdd = Math.max(mdd, (peak - e.assets) / peak);
    }
    return mdd;
  }

  /** 等权持有基准收益率（%）：开局把本金平均分给每家公司，第 1 回合开盘价买入，持有到现在（不计费用） */
  function benchmarkReturnPct(state) {
    const ids = Object.keys(state.companies);
    const r = ids.reduce((a, id) => a + lastClose(state, id) / state.benchStart[id] - 1, 0) / ids.length;
    return r * 100;
  }


  function isWin(outcome, returnPct, benchmarkPct, maxDrawdown) {
    return outcome === 'completed' && returnPct >= benchmarkPct + GameConfig.winMarginPct && maxDrawdown < GameConfig.winMaxDrawdown;
  }

  function advanceTurn(state, actions) {
    if (state.status !== 'playing') return state;
    actions = actions || {};
    let s = state;
    for (const r of actions.research || []) s = GameResearch.research(s, r.id, r.points).state;
    s = clone(s);

    const ids = Object.keys(s.companies);
    const weekIndex = s.turn - 1;                        // 第 1 回合 = 第 0 周
    const mRng = GameRng.create(s.rng.market);
    const eRng = GameRng.create(s.rng.events);

    // 1. 事件 + 生成本周 K 线
    const events = GameEvents.drawWeek(eRng, s.companies);
    const weekCandles = {};
    for (const id of ids) {
      let eff = null;
      for (const ev of events) {
        const e = ev.effects[id];
        if (e) eff = eff ? { vLog: eff.vLog + e.vLog, sShift: eff.sShift + e.sShift } : { vLog: e.vLog, sShift: e.sShift };
      }
      const r = GameMarket.simulateWeek(s.companies[id], s.carry[id], weekIndex, eff, mRng);
      s.companies[id].V = r.V; s.companies[id].s = r.s;
      const prevClose = s.carry[id].prevClose;
      s.carry[id] = { prevClose: r.prevClose, prevTarget: r.prevTarget };
      weekCandles[id] = { prevClose, candles: r.candles, vs: r.vs };
    }
    s.rng.market = mRng.state(); s.rng.events = eRng.state();

    if (!s.benchStart) {                                // 基准的买入价 = 第 1 回合第 1 日开盘价（与玩家订单同价）
      s.benchStart = {};
      for (const id of ids) s.benchStart[id] = weekCandles[id].candles[0].open;
    }

    // 2. 在第 1 日开盘价执行订单（先卖后买）
    const baseDay = s.candles[ids[0]].length;           // 本周第 1 日的全局交易日序号
    const orders = (actions.orders || []).slice().sort((a, b) => (a.side === 'sell' ? 0 : 1) - (b.side === 'sell' ? 0 : 1));
    const trades = [], failed = [];
    let account = { cash: s.cash, positions: s.positions };
    for (const o of orders) {
      const wk = weekCandles[o.id];
      if (!wk) { failed.push({ order: o, error: '未知公司' }); continue; }
      const res = GameTrading.executeOrder(account, o, {
        price: wk.candles[0].open, prevClose: wk.prevClose, day: baseDay, company: s.companies[o.id]
      });
      if (res.error) failed.push({ order: o, error: res.error });
      else { account = res.account; trades.push(res.trade); }
    }
    s.cash = account.cash; s.positions = account.positions;

    // 3. 逐日记录总资产
    for (let d = 0; d < GameConfig.daysPerTurn; d++) {
      let v = s.cash;
      for (const id of Object.keys(s.positions)) v += s.positions[id].shares * weekCandles[id].candles[d].close;
      s.equity.push({ turn: s.turn, day: baseDay + d, assets: Math.round(v * 100) / 100 });
    }
    for (const id of ids) { s.candles[id].push(...weekCandles[id].candles); s.vPath[id].push(...weekCandles[id].vs); }
    for (const t of trades) s.tradeLog.push(Object.assign({ turn: s.turn, day: baseDay }, t));

    // 4. 新闻与记录
    s.lastWeek = { turn: s.turn, trades, failed, events: events.map((e) => e.headline) };
    s.news = events.length ? events.map((e) => ({ cardId: e.cardId, headline: e.headline }))
                           : [{ cardId: null, headline: '本周市场平静，没有重大消息。' }];
    for (const e of events) s.eventLog.push({ turn: s.turn, cardId: e.cardId, kind: e.kind, headline: e.headline, targetId: e.targetId, effects: e.effects });

    // 5. 推进回合并判定结束
    const assets = s.equity[s.equity.length - 1].assets;
    const finishedTurn = s.turn;
    s.turn += 1;
    s.pointsLeft = GameConfig.research.pointsPerTurn;
    if (assets < GameConfig.bankruptcyLine) s.endReason = 'bankrupt';
    else if (finishedTurn >= GameConfig.totalTurns) s.endReason = 'completed';
    if (s.endReason) {
      s.status = 'ended';
      const returnPct = (assets / GameConfig.initialCash - 1) * 100;
      const benchPct = benchmarkReturnPct(s);
      s.result = {
        outcome: s.endReason,
        turnsPlayed: finishedTurn,
        totalAssets: assets,
        returnPct,
        benchmarkReturnPct: benchPct,
        win: isWin(s.endReason, returnPct, benchPct, maxDrawdown(s.equity)),
        maxDrawdown: maxDrawdown(s.equity),
        truth: ids.map((id) => ({ id, name: s.companies[id].name, V: Math.round(s.companies[id].V * 100) / 100, price: lastClose(s, id) }))
      };
    }
    return s;
  }

  return { newGame, advanceTurn, totalAssets, maxDrawdown, lastClose, benchmarkReturnPct, isWin };
});
