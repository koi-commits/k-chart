// 游戏核心的正式测试：node --test tests/（即 npm test）
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const G = (m) => require(path.join(__dirname, '..', 'js', 'game', m));
const Config = G('config.js'), Rng = G('rng.js'), State = G('game-state.js'),
  Research = G('research.js'), Trading = G('trading.js'), Companies = G('companies.js');

const playOut = (s, actionsFor) => { while (s.status === 'playing') s = State.advanceTurn(s, actionsFor ? actionsFor(s) : {}); return s; };

test('同一种子确定性重现，不同种子结果不同', () => {
  assert.deepEqual(State.newGame(42), State.newGame(42));
  assert.notDeepEqual(State.newGame(42).candles, State.newGame(43).candles);
});

test('RNG：同状态同序列，state() 可恢复', () => {
  const a = Rng.create(7), b = Rng.create(7);
  assert.equal(a.next(), b.next());
  const st = a.state(); const x = a.next();
  assert.equal(Rng.create(st).next(), x);
});

test('advanceTurn 是纯函数：不修改入参', () => {
  const s = State.newGame(5);
  const before = JSON.stringify(s);
  State.advanceTurn(s, { orders: [{ id: 'jzjy', side: 'buy', shares: 100 }] });
  assert.equal(JSON.stringify(s), before);
});

test('玩家行动不改变价格路径（三条独立随机流）', () => {
  const a = playOut(State.newGame(9));
  const b = playOut(State.newGame(9), (s) => ({ research: [{ id: 'jzjy', points: 1 }], orders: [{ id: 'xhkj', side: 'buy', shares: 100 }] }));
  assert.deepEqual(a.candles, b.candles);
});

test('公司参数随种子变化，且落在行业范围内', () => {
  const seen = { growth: new Set(), debt: new Set(), vol: new Set() };
  for (let seed = 1; seed <= 50; seed++) {
    const co = State.newGame(seed).companies;
    for (const id in co) {
      const rg = Config.industries[co[id].industry];
      assert.ok(co[id].growth >= rg.growth[0] && co[id].growth <= rg.growth[1], `${id} growth 越界`);
      assert.ok(co[id].vol >= rg.vol[0] && co[id].vol <= rg.vol[1], `${id} vol 越界`);
      assert.ok(co[id].debt >= rg.debt[0] && co[id].debt <= rg.debt[1], `${id} debt 越界`);
    }
    seen.growth.add(co.gcxn.growth); seen.debt.add(co.gcxn.debt); seen.vol.add(co.gcxn.vol);
  }
  for (const k in seen) assert.ok(seen[k].size >= 35, `${k} 应随种子明显变化`);
  // 同种子参数不变；名称与行业固定
  assert.deepEqual(State.newGame(3).companies.gcxn.growth, State.newGame(3).companies.gcxn.growth);
  assert.equal(State.newGame(1).companies.hydc.name, '华岳地产');
  assert.equal(State.newGame(2).companies.hydc.industryName, '地产');
});

test('行业范围有重叠且 growth 中点相同（不存在必涨行业）', () => {
  const g = Object.values(Config.industries).map((r) => r.growth);
  const lo = Math.max(...g.map((r) => r[0])), hi = Math.min(...g.map((r) => r[1]));
  assert.ok(lo < hi, 'growth 范围应有公共重叠区');
  for (const r of g) assert.ok(Math.abs((r[0] + r[1]) / 2 - 0.08) < 1e-9);
  assert.equal(Companies.ids().length, 4);
});

test('胜利条件：完成全部回合、收益率 ≥ 基准 + X、最大回撤 < Y', () => {
  const X = Config.winMarginPct, Y = Config.winMaxDrawdown;
  assert.equal(State.isWin('completed', 10 + X, 10, 0.1), true);              // 恰好达标
  assert.equal(State.isWin('completed', 10 + X - 0.01, 10, 0.1), false);      // 收益差一点
  assert.equal(State.isWin('completed', 50, 10 + 50, 0.1), false);            // 基准更高
  assert.equal(State.isWin('bankrupt', 500, 0, 0.1), false);                  // 判负永远不算胜
  assert.equal(State.isWin('completed', -20, -45 - X + 25, 0.1), true);       // 熊市跑赢基准也算
  assert.equal(State.isWin('completed', 100, 0, Y - 0.001), true);            // 回撤刚好够小
  assert.equal(State.isWin('completed', 100, 0, Y), false);                   // 回撤 = Y 不算（严格小于）
  assert.equal(State.isWin('completed', 100, 0, 0.6), false);                 // 收益再高，回撤过大也不算
});

test('基准收益率 = 开局开盘价等权买入持有至今', () => {
  let s = State.newGame(11);
  s = State.advanceTurn(s, {});
  const ids = Object.keys(s.companies);
  const expected = ids.reduce((a, id) => a + State.lastClose(s, id) / s.benchStart[id] - 1, 0) / ids.length * 100;
  assert.ok(Math.abs(State.benchmarkReturnPct(s) - expected) < 1e-9);
  const end = playOut(s);
  assert.equal(end.result.benchmarkReturnPct, State.benchmarkReturnPct(end));
  assert.equal(end.result.win, State.isWin(end.result.outcome, end.result.returnPct, end.result.benchmarkReturnPct, end.result.maxDrawdown));
});

test('游戏流程：20 回合结束、结算字段齐全', () => {
  const end = playOut(State.newGame(1));
  assert.equal(end.status, 'ended');
  assert.equal(end.result.outcome, 'completed');
  assert.equal(end.turn, Config.totalTurns + 1);
  assert.equal(end.candles.jzjy.length, Config.warmupWeeks * 5 + Config.totalTurns * 5);
  assert.equal(end.result.truth.length, 4);
  assert.ok(end.result.maxDrawdown >= 0 && end.result.maxDrawdown <= 1);
  assert.equal(State.advanceTurn(end, {}), end); // 结束后不再推进
});

test('判负：总资产低于 30000 时提前结束', () => {
  let s = State.newGame(1);
  s = JSON.parse(JSON.stringify(s)); s.cash = Config.bankruptcyLine - 1;
  s = State.advanceTurn(s, {});
  assert.equal(s.status, 'ended'); assert.equal(s.result.outcome, 'bankrupt'); assert.equal(s.result.win, false);
});

test('最大回撤', () => {
  const e = [100, 120, 90, 110, 60, 80].map((assets) => ({ assets }));
  assert.ok(Math.abs(State.maxDrawdown(e) - 0.5) < 1e-12);
  assert.equal(State.maxDrawdown([{ assets: 1 }, { assets: 2 }]), 0);
});

test('研究：点数限制、误差随投入递减、4 回合后过期', () => {
  const s = State.newGame(3);
  assert.equal(Research.research(s, 'jzjy', 4).error, '研究点不足');
  assert.ok(Research.sigmaFor(3) < Research.sigmaFor(2) && Research.sigmaFor(2) < Research.sigmaFor(1));
  let r = Research.research(s, 'jzjy', 3).state;
  assert.equal(r.pointsLeft, 0);
  assert.equal(Research.research(r, 'xhkj', 1).error, '研究点不足');
  assert.equal(Research.getEstimate(r, 'jzjy').remaining, 4);
  for (let i = 0; i < 3; i++) r = State.advanceTurn(r, {});
  assert.equal(Research.getEstimate(r, 'jzjy').remaining, 1);   // 第 4 回合仍有效
  r = State.advanceTurn(r, {});
  assert.equal(Research.getEstimate(r, 'jzjy'), null);          // 第 5 回合过期
});

test('研究估计的统计误差与 sigma 一致', () => {
  const errs = [];
  for (let seed = 1; seed <= 400; seed++) {
    const s = State.newGame(seed);
    const e = Research.getEstimate(Research.research(s, 'jzjy', 1).state, 'jzjy');
    errs.push(Math.log(e.estimate / s.companies.jzjy.V));
  }
  const m = errs.reduce((a, b) => a + b, 0) / errs.length;
  const sd = Math.sqrt(errs.reduce((a, b) => a + (b - m) ** 2, 0) / errs.length);
  assert.ok(Math.abs(sd - Research.sigmaFor(1)) < 0.02, `sd=${sd}`);
});

test('交易：费率、T+1、涨跌停', () => {
  assert.deepEqual(Trading.calcFee('sell', 10, 1000), { commission: 5, stampDuty: 10, transferFee: 0.2, total: 15.2 });
  assert.equal(Trading.calcFee('buy', 10, 1000).stampDuty, 0);
  const ctx = { price: 11, prevClose: 10, day: 5, company: { vol: 0.01, adv: 2e6 } };
  assert.equal(Trading.executeOrder({ cash: 1e5, positions: {} }, { id: 'x', side: 'buy', shares: 100 }, ctx).error, '涨停，无法买入');
  const held = { cash: 1e5, positions: { x: { shares: 100, avgCost: 10, boughtDay: 5, boughtQty: 100 } } };
  assert.match(Trading.executeOrder(held, { id: 'x', side: 'sell', shares: 100 }, { ...ctx, price: 10 }).error, /T\+1/);
  const old = { cash: 1e5, positions: { x: { shares: 100, avgCost: 10, boughtDay: 4, boughtQty: 100 } } };
  assert.equal(Trading.executeOrder(old, { id: 'x', side: 'sell', shares: 100 }, { ...ctx, price: 9 }).error, '跌停，无法卖出');
  assert.ok(Trading.executeOrder(old, { id: 'x', side: 'sell', shares: 100 }, { ...ctx, price: 10 }).trade);
});

test('回合内买入的股票同回合不可卖（T+1），下回合可卖', () => {
  let s = State.advanceTurn(State.newGame(2), { orders: [{ id: 'jzjy', side: 'buy', shares: 200 }, { id: 'jzjy', side: 'sell', shares: 100 }] });
  assert.equal(s.positions.jzjy.shares, 200);
  assert.equal(s.lastWeek.failed.length, 1);
  s = State.advanceTurn(s, { orders: [{ id: 'jzjy', side: 'sell', shares: 100 }] });
  assert.equal(s.positions.jzjy.shares, 100);
});

test('游戏逻辑不直接调用 Math.random', () => {
  const fs = require('fs'), dir = path.join(__dirname, '..', 'js', 'game');
  for (const f of fs.readdirSync(dir)) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random/.test(code), `${f} 使用了 Math.random`);
  }
});

test('试玩记录：回合行动记录后可重放出完全相同的结果', () => {
  const Record = G('record.js');
  let s = State.newGame(77);
  const rec = Record.create(77, '2026-01-01T00:00:00.000Z');
  const ids = Object.keys(s.companies);
  while (s.status === 'playing') {
    const id = ids[s.turn % ids.length];
    let cur = s;
    if (s.turn % 3 === 0) {                       // 有的回合做研究
      const r = Research.research(cur, id, 2); cur = r.state;
      rec.pending.research.push({ id, points: 2, estimate: cur.research[id].estimate });
    }
    const orders = s.turn % 2 ? [{ id, side: 'buy', shares: 200 }] : [{ id, side: 'sell', shares: 100 }];
    const next = State.advanceTurn(cur, { orders });
    Record.commitTurn(rec, { turn: s.turn, orders, durationMs: 1234.4, newsShown: s.news.map((n) => n.headline), state: next, endedAt: 'x' });
    s = next;
  }
  assert.equal(rec.turns.length, Config.totalTurns);
  assert.equal(rec.turns[0].durationMs, 1234);
  assert.equal(rec.result.totalAssets, s.result.totalAssets);
  assert.equal(rec.truth.length, 4);
  const again = Record.replay(rec);
  assert.deepEqual(again.result, s.result);
  assert.deepEqual(again.tradeLog, s.tradeLog);
  JSON.parse(JSON.stringify(rec)); // 可序列化
});

test('复盘所需数据：V 路径与 K 线对齐、事件带文本、研究史带真实 V', () => {
  let s = State.newGame(8);
  s = Research.research(s, 'xhkj', 1).state;
  s = State.advanceTurn(s, { orders: [{ id: 'xhkj', side: 'buy', shares: 100 }] });
  for (const id in s.candles) assert.equal(s.vPath[id].length, s.candles[id].length);
  assert.equal(s.researchLog.length, 1);
  assert.ok(s.researchLog[0].trueV > 0);
  assert.equal(s.tradeLog.length, 1);
  const end = playOut(s);
  assert.ok(end.eventLog.length > 0 && end.eventLog.every((e) => typeof e.headline === 'string' && e.effects));
});
