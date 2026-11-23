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

test('评分：季度分（基础分 + 超额 + 上下限）', () => {
  const S = G('scoring.js'), c = Config.scoring.quarter;
  const win = S.quarterScore(4);                                       // 跑赢：基础分 + 超额部分
  assert.equal(win.base, c.beatBase); assert.ok(Math.abs(win.score - (c.beatBase + c.perPoint * 4)) < 1e-12);
  const lose = S.quarterScore(-4);                                     // 没跑赢：没有基础分，按超额扣
  assert.equal(lose.base, 0); assert.ok(Math.abs(lose.score - c.perPoint * -4) < 1e-12);
  assert.equal(S.quarterScore(0).base, 0);                             // 恰好持平不算跑赢
  assert.equal(S.quarterScore(1e6).score, c.max); assert.equal(S.quarterScore(1e6).clamped, true);   // 上限
  assert.equal(S.quarterScore(-1e6).score, c.min);                     // 下限
  // 单调不减
  let prev = -Infinity; for (let x = -100; x <= 100; x += 0.5) { const s = S.quarterScore(x).score; assert.ok(s >= prev - 1e-12); prev = s; }
});

test('评分：终局分与回撤扣分（有扣分上限）；总分有下限', () => {
  const S = G('scoring.js'), f = Config.scoring.final, d = Config.scoring.drawdown;
  assert.ok(Math.abs(S.finalScore(10).score - f.perPoint * 10) < 1e-12);
  assert.equal(S.finalScore(1e6).score, f.max); assert.equal(S.finalScore(-1e6).score, f.min);
  assert.equal(S.drawdownPenalty(0).penalty, 0);
  assert.equal(S.drawdownPenalty(d.threshold).penalty, 0);              // 刚到阈值不扣
  assert.ok(Math.abs(S.drawdownPenalty(d.threshold + 0.05).penalty - 5 * d.perPoint) < 1e-9);   // 超出 5 个百分点
  const big = S.drawdownPenalty(0.9);
  assert.equal(big.penalty, d.maxPenalty); assert.equal(big.capped, true); assert.ok(big.raw > big.penalty);   // 扣分封顶
  assert.equal(S.drawdownPenalty(d.threshold + 0.01).capped, false);
  // 总分下限：再差也不低于 totalMin
  const worst = S.summarize([-50, -50, -50, -50], -80, 0.9);
  assert.equal(worst.total, Config.scoring.totalMin); assert.equal(worst.totalFloored, true); assert.ok(worst.rawTotal < worst.total);
});

test('评分：总分 = 季度分之和 + 终局分 − 回撤扣分；等级线与过关', () => {
  const S = G('scoring.js'), g = Config.scoring.grades;
  const r = S.summarize([3, -2, 6, 1], 12, 0.14);
  const q = [3, -2, 6, 1].reduce((a, x) => a + S.quarterScore(x).score, 0);
  const expect = Math.max(Config.scoring.totalMin, q + S.finalScore(12).score - S.drawdownPenalty(0.14).penalty);
  assert.ok(Math.abs(r.total - expect) < 1e-9); assert.equal(r.quarters.length, 4);
  assert.deepEqual([S.gradeOf(g.S), S.gradeOf(g.A), S.gradeOf(g.B), S.gradeOf(g.C), S.gradeOf(g.C - 0.01)], ['S', 'A', 'B', 'C', 'D']);
  assert.deepEqual([S.gradeOf(g.S - 0.01), S.gradeOf(g.A - 0.01), S.gradeOf(g.B - 0.01)], ['A', 'B', 'C']);
  assert.deepEqual(['S', 'A', 'B', 'C', 'D'].map((x) => S.isPass(x)), [true, true, true, false, false]);   // B 及以上过关
  assert.deepEqual(S.nextGrade(g.B + 1), { grade: 'A', need: g.A - g.B - 1 });
  assert.equal(S.nextGrade(g.S + 5), null);
  assert.equal(S.nextGrade(-50).grade, 'C');
});

test('评分：提前判死 = 剩余季度与终局全拿上限仍达不到 B', () => {
  const S = G('scoring.js'), c = Config.scoring, B = c.grades.B;
  const th = c.drawdown.threshold;
  const best = S.bestPossible([c.quarter.min, c.quarter.min], th);           // 前两季度都拿下限，回撤刚到阈值（不扣分）
  assert.ok(Math.abs(best - (2 * c.quarter.min + 2 * c.quarter.max + c.final.max)) < 1e-9);
  assert.equal(S.isDead([c.quarter.min, c.quarter.min], th), best < B);
  assert.equal(S.isDead([c.quarter.max, c.quarter.max], 0), false);           // 前两季度满分，必然还活着或已够
  // 回撤扣分只增不减：回撤越大，上界越低
  assert.ok(S.bestPossible([0, 0], 0.5) < S.bestPossible([0, 0], 0.1));
  // 全部季度完成后上界 = 实际季度分 + 终局上限 − 扣分
  assert.ok(Math.abs(S.bestPossible([1, 2, 3, 4], 0) - (10 + c.final.max)) < 1e-9);
});

test('季度考核：4 个季度 × 5 回合 = 20 回合；各季度收益复利后等于总收益（玩家与基准）', () => {
  const S2 = G('scoring.js');
  assert.equal(Config.quarters * Config.quarterLength, Config.totalTurns);
  const ids = Object.keys(State.newGame(1).companies);
  for (const seed of [3, 11, 29]) {
    let s = State.newGame(seed);
    while (s.status === 'playing') s = State.advanceTurn(s, { orders: s.turn === 1 ? [{ id: ids[seed % 4], side: 'buy', shares: 300 }] : [] });
    const q = State.quarterResults(s);
    assert.equal(q.length, Config.quarters);
    const player = q.reduce((a, x) => a * (1 + x.playerPct / 100), 1), bench = q.reduce((a, x) => a * (1 + x.benchPct / 100), 1);
    assert.ok(Math.abs(player - s.result.totalAssets / Config.initialCash) < 1e-9, '玩家季度复利应等于总收益');
    assert.ok(Math.abs((bench - 1) * 100 - s.result.benchmarkReturnPct) < 1e-9, '基准季度复利应等于基准总收益');
    for (const x of q) assert.equal(x.beat, x.playerPct > x.benchPct);
    assert.equal(s.result.quartersBeaten, q.filter((x) => x.beat).length);
    assert.equal(s.result.pass, S2.isPass(s.result.grade)); assert.equal(s.result.grade, S2.gradeOf(s.result.score.total));
  }
});

test('季度考核：空仓玩家只有在基准下跌的季度才算跑赢（躺平赢不了）', () => {
  let s = State.newGame(13);
  while (s.status === 'playing') s = State.advanceTurn(s, {});
  for (const x of s.result.quarters) { assert.equal(x.playerPct, 0); assert.equal(x.beat, x.benchPct < 0); }
});

test('评分进度 progress：当前季度/回合、本季度得分、累计总分与预估等级（无"已无法获胜"）', () => {
  const Summary = G('summary.js'), Sc = G('scoring.js');
  let s = State.newGame(13);
  let p = Summary.progress(s);
  assert.deepEqual([p.quarter.q, p.quarter.turnInQuarter, p.quarter.completed], [1, 1, 0]);
  assert.equal(p.score.total, 0); assert.equal(p.score.grade, 'D'); assert.equal(p.score.next.grade, 'C');
  for (let i = 0; i < 6; i++) s = State.advanceTurn(s, {});
  p = Summary.progress(s);
  assert.deepEqual([p.quarter.q, p.quarter.turnInQuarter, p.quarter.completed], [2, 2, 1]);
  assert.equal(p.quarter.pills[0].state, 'done'); assert.equal(p.quarter.pills[1].state, 'cur'); assert.equal(p.quarter.pills[3].state, 'future');
  // 累计总分 = 假设现在结束的得分，且与 scoreSnapshot 一致；等级与总分一致
  const snap = State.scoreSnapshot(s);
  assert.ok(Math.abs(p.score.total - snap.total) < 1e-12); assert.equal(p.score.grade, Sc.gradeOf(snap.total));
  assert.ok(Math.abs(p.quarter.score - snap.quarters[1].score) < 1e-12, '本季度目前得分应等于快照里第 2 季度得分');
  if (p.score.next) assert.ok(Math.abs(p.score.next.need - (Config.scoring.grades[p.score.next.grade] - p.score.total)) < 1e-9);
  assert.ok(!('impossible' in p.quarter) && !('need' in p.quarter), '不再提示已无法获胜');
  // 回放中（upto）：回到第 5 回合结束那一刻，第 1 季度刚好完成
  const warm = Config.warmupWeeks * Config.daysPerTurn;
  assert.equal(Summary.progress(s, warm + 25).quarter.completed, 1);
  assert.equal(Summary.progress(s, warm + 24).quarter.completed, 0);
});

test('终局评分：result.score 与逐项公式一致；中途判负一律 D', () => {
  const Sc = G('scoring.js');
  const end = playOut(State.newGame(21));
  const sc = end.result.score;
  assert.equal(sc.quarters.length, Config.quarters);
  const q = sc.quarters.reduce((a, x) => a + x.score, 0);
  const finalEx = end.result.returnPct - end.result.benchmarkReturnPct;
  const expect = Math.max(Config.scoring.totalMin, q + Sc.finalScore(finalEx).score - Sc.drawdownPenalty(end.result.excessDrawdown).penalty);
  assert.ok(Math.abs(sc.total - expect) < 1e-9);
  assert.ok(Math.abs(end.result.excessDrawdown - State.excessDrawdown(end, end.equity.length - 1)) < 1e-12);
  assert.equal(end.result.grade, Sc.gradeOf(sc.total)); assert.equal(end.result.pass, Sc.isPass(end.result.grade));
  let s = JSON.parse(JSON.stringify(State.newGame(1))); s.cash = Config.bankruptcyLine - 1;
  s = State.advanceTurn(s, {});
  assert.equal(s.result.outcome, 'bankrupt'); assert.equal(s.result.grade, 'D'); assert.equal(s.result.pass, false);
});

test('试玩记录：restartCount 默认 0，create 时可沿用', () => {
  const Record = G('record.js');
  assert.equal(Record.create(1, 'x').restartCount, 0);
  assert.equal(Record.create(1, 'x', 3).restartCount, 3);
  assert.equal(Record.create(1, 'x').gameVersion, Config.gameVersion);
  assert.deepEqual(Record.create(1, 'x').rules.scoring, Config.scoring);
});

test('基准收益率 = 开局开盘价等权买入持有至今', () => {
  let s = State.newGame(11);
  s = State.advanceTurn(s, {});
  const ids = Object.keys(s.companies);
  const expected = ids.reduce((a, id) => a + State.lastClose(s, id) / s.benchStart[id] - 1, 0) / ids.length * 100;
  assert.ok(Math.abs(State.benchmarkReturnPct(s) - expected) < 1e-9);
  const end = playOut(s);
  assert.equal(end.result.benchmarkReturnPct, State.benchmarkReturnPct(end));
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
  assert.equal(s.status, 'ended'); assert.equal(s.result.outcome, 'bankrupt'); assert.equal(s.result.pass, false);
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
  assert.equal(rec.gameVersion, Config.gameVersion);
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

test('summary.progress：收益率/基准/最大回撤', () => {
  const Summary = G('summary.js');
  let s = State.newGame(5);
  let p = Summary.progress(s);
  assert.equal(p.returnPct, 0); assert.equal(p.benchPct, 0); assert.equal(p.maxDD, 0); assert.equal(p.ddPenalty, 0);
  s = State.advanceTurn(s, { orders: [{ id: 'jzjy', side: 'buy', shares: 300 }] });
  p = Summary.progress(s);
  assert.ok(Math.abs(p.benchPct - State.benchmarkReturnPct(s)) < 1e-9);
  assert.ok(Math.abs(p.maxDD - State.excessDrawdown(s, s.equity.length - 1)) < 1e-12);
  assert.ok(Math.abs(p.absMaxDD - State.maxDrawdown(s.equity)) < 1e-12);
  const base = s.candles.jzjy.length - 5;
  assert.equal(Summary.progress(s, base + 5).assets, p.assets);
  assert.equal(Summary.progress(s, base + 1).maxDD <= p.maxDD, true);
  assert.equal(p.ddThreshold, Config.scoring.drawdown.threshold);
});

test('summary.weekSummary：各公司盈亏之和 = 本周总资产变化；不泄露真实价值', () => {
  const Summary = G('summary.js');
  let s = State.newGame(21);
  const ids = Object.keys(s.companies);
  for (let t = 1; t <= 6; t++) {
    const prevAssets = s.equity[s.equity.length - 1].assets;
    const orders = t === 1 ? ids.map((id) => ({ id, side: 'buy', shares: 100 }))
      : t === 4 ? [{ id: ids[0], side: 'sell', shares: 100 }] : [{ id: ids[t % 4], side: 'buy', shares: 100 }];
    s = State.advanceTurn(s, { orders });
    const w = Summary.weekSummary(s, t);
    const sum = w.rows.reduce((a, r) => a + r.pnl, 0);
    assert.ok(Math.abs(sum - w.total) < 0.05, `第${t}回合 分项之和 ${sum} ≠ 总计 ${w.total}`);
    assert.ok(Math.abs(w.total - (s.equity[s.equity.length - 1].assets - prevAssets)) < 0.2, `第${t}回合 总盈亏应等于总资产变化`);
    assert.equal(w.fees, Math.round(w.trades.reduce((a, x) => a + x.fee, 0) * 100) / 100);
    const text = JSON.stringify(w);
    assert.ok(!('V' in w) && !/trueV|vLog|sShift|fundamental|sentiment/.test(text), '小结不得包含真实价值或事件性质');
  }
  const h = Summary.historyOf(s, 3);
  assert.ok(!/trueV/.test(JSON.stringify(h)));
});

// ── 卖出所得用于同回合买入：足额 / 部分成交 / 全部未成交 ──
function fundingState() {
  const s = State.newGame(5);
  s.cash = 0;
  s.positions = { jzjy: { shares: 1000, avgCost: 100, boughtDay: -1, boughtQty: 0 } }; // 早就持有，可卖
  return s;
}
const px = (s, id) => State.lastClose(s, id);

test('同回合买入（足额）：先卖后买，卖出所得足以支付买单', () => {
  const s = fundingState();
  const proceeds = 500 * px(s, 'jzjy');                       // 卖 5 手所得（约）
  const buyShares = Math.floor((proceeds * 0.5) / px(s, 'xhkj') / 100) * 100;   // 只花一半
  assert.ok(buyShares >= 100);
  const n = State.advanceTurn(s, { orders: [{ id: 'xhkj', side: 'buy', shares: buyShares }, { id: 'jzjy', side: 'sell', shares: 500 }] });
  const buy = n.lastWeek.trades.find((t) => t.side === 'buy');
  assert.equal(buy.shares, buyShares);
  assert.equal(buy.requested, undefined);
  assert.equal(n.lastWeek.failed.length, 0);
  assert.ok(n.cash > 0);
});

test('同回合买入（部分成交）：所得不足时按可买手数成交，剩余标记资金不足未成交', () => {
  const s = fundingState();
  const proceeds = 500 * px(s, 'jzjy');
  const want = Math.floor((proceeds * 2.5) / px(s, 'xhkj') / 100) * 100;        // 想买 2.5 倍
  const n = State.advanceTurn(s, { orders: [{ id: 'jzjy', side: 'sell', shares: 500 }, { id: 'xhkj', side: 'buy', shares: want }] });
  const buy = n.lastWeek.trades.find((t) => t.side === 'buy');
  assert.ok(buy && buy.shares >= 100 && buy.shares < want, `应部分成交，实际 ${buy && buy.shares}/${want}`);
  assert.equal(buy.requested, want);
  assert.equal(buy.shares % 100, 0);
  const f = n.lastWeek.failed.find((x) => x.error === '资金不足未成交');
  assert.ok(f && f.partial && f.order.shares === want - buy.shares, '剩余部分应记为资金不足未成交');
  assert.ok(n.cash >= 0 && n.cash < 2 * px(n, 'xhkj') * 100 * 1.2, '现金应基本用尽（不足再买一手）');
  assert.equal(n.failedLog.length, 1);
  // 小结里能看到
  const w = G('summary.js').weekSummary(n, 1);
  assert.equal(w.failed[0].error, '资金不足未成交');
  assert.equal(w.trades.find((t) => t.side === 'buy').requested, want);
});

test('同回合买入（全部未成交）：没有现金也没有卖出所得', () => {
  const s = fundingState();
  const n = State.advanceTurn(s, { orders: [{ id: 'xhkj', side: 'buy', shares: 300 }] });
  assert.equal(n.lastWeek.trades.length, 0);
  assert.equal(n.lastWeek.failed.length, 1);
  assert.equal(n.lastWeek.failed[0].error, '资金不足未成交');
  assert.equal(n.lastWeek.failed[0].order.shares, 300);
  assert.equal(n.cash, 0);
});

test('多笔买单按下单顺序成交：前面的买单先用资金，后面的不足', () => {
  const s = fundingState();
  const proceeds = 500 * px(s, 'jzjy');
  const first = Math.floor((proceeds * 0.9) / px(s, 'xhkj') / 100) * 100;
  const n = State.advanceTurn(s, { orders: [
    { id: 'xhkj', side: 'buy', shares: first }, { id: 'gcxn', side: 'buy', shares: 500 }, { id: 'jzjy', side: 'sell', shares: 500 }] });
  const bought = n.lastWeek.trades.filter((t) => t.side === 'buy');
  assert.equal(bought[0].id, 'xhkj'); assert.equal(bought[0].shares, first);
  assert.ok(n.lastWeek.failed.some((f) => f.order.id === 'gcxn' && f.error === '资金不足未成交'));
});

test('研究后相关新闻：只列研究之后、与该公司/行业有关的新闻标题，不含方向幅度', () => {
  const Summary = G('summary.js');
  let s = State.newGame(8);
  s = JSON.parse(JSON.stringify(s));
  // 第 3 回合研究金樽；手工构造事件日志：研究之前的事件、研究回合的事件、之后的相关/无关事件
  s.turn = 3; s.status = 'playing';
  s = Research.research(s, 'jzjy', 2).state;
  const ev = (turn, targets, headline, kind) => ({ turn, cardId: 'x', kind, headline, targetId: targets[0], effects: Object.fromEntries(targets.map((t) => [t, { vLog: 0.1, sShift: 0.02 }])) });
  s.eventLog = [ev(2, ['jzjy'], '研究前的新闻', 'fundamental'), ev(3, ['jzjy'], '研究当周的新闻', 'fundamental'),
    ev(4, ['gcxn'], '别家公司的新闻', 'sentiment'), ev(5, ['jzjy', 'gcxn'], '行业新闻', 'sentiment')];
  const list = Summary.newsSinceResearch(s, 'jzjy');
  assert.deepEqual(list.map((x) => x.headline), ['研究当周的新闻', '行业新闻']);
  assert.deepEqual(Object.keys(list[0]).sort(), ['headline', 'turn']);               // 只有回合与标题
  assert.ok(!/fundamental|sentiment|vLog|sShift|0\.1/.test(JSON.stringify(list)));
  assert.deepEqual(Summary.newsSinceResearch(s, 'xhkj'), []);                         // 没研究过 → 无
  assert.deepEqual(Summary.newsSinceResearch(s, 'gcxn'), []);
  // 重新研究后，之前的新闻不再算
  s.turn = 6; s.pointsLeft = 3;
  s = Research.research(s, 'jzjy', 1).state;
  assert.deepEqual(Summary.newsSinceResearch(s, 'jzjy'), []);
});

test('回合小结的回撤：用相对基准的周收盘回撤；当前回落不超过截至周末的最大回撤', () => {
  const Summary = G('summary.js');
  let s = State.newGame(2);
  const ids = Object.keys(s.companies);
  for (let t = 1; t <= 8; t++) {
    s = State.advanceTurn(s, { orders: t === 1 ? ids.map((id) => ({ id, side: 'buy', shares: 100 })) : [] });
    const w = Summary.weekSummary(s, t);
    const endAssets = s.equity[t * Config.daysPerTurn].assets;
    let peak = -Infinity; for (let d = 0; d <= t * Config.daysPerTurn; d++) peak = Math.max(peak, s.equity[d].assets);
    assert.ok(w.weekDrawdown <= w.maxDrawdownSoFar + 1e-12);     // 当前回落不超过历史最大
    assert.ok(Math.abs(w.maxDrawdownSoFar - State.excessDrawdown(s, t * Config.daysPerTurn)) < 1e-12);
  }
});

// ── 新闻文案 ──
const Events = G('events.js');
const allHeadlines = () => {
  const out = [];
  for (const c of Events.CARDS) for (const tpl of [...c.strong, ...c.weak]) {
    out.push({ card: c.id, kind: c.kind, dir: c.dir, text: tpl.replace('{name}', '某公司').replace('{industry}', '某行业') });
  }
  return out;
};

test('新闻文案：没有直接暴露类型的尾句，每张卡有轻/重两档说法', () => {
  const banned = ['一切正常', '基本面无明显变化', '经营正常', '基本面没有变化', '并非基本面', '纯属情绪', '情绪炒作'];
  for (const h of allHeadlines()) for (const b of banned) assert.ok(!h.text.includes(b), `"${h.text}" 含有暴露类型的措辞 "${b}"`);
  for (const c of Events.CARDS) assert.ok(c.strong.length >= 1 && c.weak.length >= 1, `${c.id} 应有重/轻两档`);
  // 区分度：同一张卡的重/轻说法不相同，且不再有"具体金额未披露"这种读完就知道无关紧要的话
  for (const c of Events.CARDS) assert.ok(c.strong.every((s) => !c.weak.includes(s)));
  assert.ok(allHeadlines().every((h) => !h.text.includes('具体金额未披露')));
});

test('新闻文案：仅凭关键词无法 100% 判断是基本面还是情绪', () => {
  const hs = allHeadlines();
  assert.ok(hs.filter((h) => h.kind === 'fundamental').length >= 8 && hs.filter((h) => h.kind === 'sentiment').length >= 8);
  // 1) 任何一个 2–8 字的子串，都不能"出现 ⇔ 某一类型"（即不存在能 100% 区分两类的单个关键词）
  const subs = new Set();
  for (const h of hs) for (let n = 2; n <= 8; n++) for (let i = 0; i + n <= h.text.length; i++) subs.add(h.text.slice(i, i + n));
  for (const s of subs) {
    const has = hs.filter((h) => h.text.includes(s)), not = hs.filter((h) => !h.text.includes(s));
    const perfect = (kind) => has.every((h) => h.kind === kind) && not.every((h) => h.kind !== kind);
    assert.ok(!perfect('sentiment') && !perfect('fundamental'), `关键词"${s}"能 100% 区分类型`);
  }
  // 2) 两个典型的"朴素关键词分类器"都会判错：情绪词/基本面词在两类标题里交叉出现
  const sentWords = ['传闻', '传言', '流传', '未予证实', '暂无公告', '减持', '追捧', '涨停', '异动', '自媒体', '看多', '抛压'];
  const fundWords = ['业绩', '利润', '订单', '合同', '监管', '再融资', '需求', '营收', '经营'];
  const byS = (h) => (sentWords.some((w) => h.text.includes(w)) ? 'sentiment' : 'fundamental');
  const byF = (h) => (fundWords.some((w) => h.text.includes(w)) ? 'fundamental' : 'sentiment');
  const accS = hs.filter((h) => byS(h) === h.kind).length / hs.length, accF = hs.filter((h) => byF(h) === h.kind).length / hs.length;
  assert.ok(accS < 1 && accF < 1, `朴素分类器不应 100% 正确：情绪词 ${accS}，基本面词 ${accF}`);
  assert.ok(hs.some((h) => h.kind === 'sentiment' && fundWords.some((w) => h.text.includes(w))), '应有含基本面词汇的情绪标题');
  assert.ok(hs.some((h) => h.kind === 'fundamental' && sentWords.some((w) => h.text.includes(w))), '应有含情绪词汇的基本面标题');
});

test('新闻：同一周同一家公司不会同时出现方向相反的两条', () => {
  const dir = Object.fromEntries(Events.CARDS.map((c) => [c.id, c.dir]));
  let twoEvent = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const end = playOut(State.newGame(seed));
    const byTurn = {};
    for (const e of end.eventLog) (byTurn[e.turn] = byTurn[e.turn] || []).push(e);
    for (const evs of Object.values(byTurn)) {
      if (evs.length < 2) continue;
      twoEvent++;
      const d = {};
      for (const e of evs) for (const id of Object.keys(e.effects)) { if (d[id] !== undefined) assert.equal(d[id], dir[e.cardId], `seed ${seed}：同周同公司方向相反`); d[id] = dir[e.cardId]; }
    }
  }
  assert.ok(twoEvent > 20, '样本里应有足够多的同周双事件');
});

test('超额回撤：按周收盘、相对基准净值；大盘下跌时少跌不扣分；盘中回落不计', () => {
  const real = State.newGame(3);
  const ids = Object.keys(real.companies);
  const sizes = ids.map((id) => ({ id, side: 'buy', shares: 100 }));
  // 1) 空仓躺平：绝对回撤为 0，超额回撤非负
  let s = real;
  for (let t = 1; t <= 6; t++) s = State.advanceTurn(s, {});
  assert.ok(State.excessDrawdown(s, s.equity.length - 1) >= 0);
  // 3) 盘中不计：把某个非周收盘日的资产砸低，超额回撤不变
  let a = State.newGame(7);
  a = State.advanceTurn(a, { orders: sizes });
  a = State.advanceTurn(a, {});
  const d = a.equity.length - 1;
  const before = State.excessDrawdown(a, d);
  const hacked = JSON.parse(JSON.stringify(a));
  const mid = Config.daysPerTurn + 2;                      // 第 2 周的周中某一天，不是周收盘
  hacked.equity[mid].assets *= 0.5;
  assert.equal(State.excessDrawdown(hacked, d), before);
  // 4) 周收盘点被砸低则会计入
  const hacked2 = JSON.parse(JSON.stringify(a));
  hacked2.equity[Config.daysPerTurn].assets *= 0.5;
  assert.ok(State.excessDrawdown(hacked2, d) > before);
});

test('summary.progress：季度目标、封顶/触底、开局未开始、距下一等级过远时标记', () => {
  const Summary = G('summary.js'), Sc = G('scoring.js'), Q = Config.scoring.quarter;
  let s = State.newGame(5);
  let p = Summary.progress(s);
  assert.equal(p.started, false); assert.equal(p.quarter.limit, null);
  assert.equal(p.quarter.gapToBase, 0); assert.equal(p.quarter.targetCap, (Q.max - Q.beatBase) / Q.perPoint);
  assert.ok(Math.abs(p.room - (Sc.bestPossible([], 0) - p.score.total)) < 1e-9);
  s = State.advanceTurn(s, {});
  p = Summary.progress(s);
  assert.equal(p.started, true);
  // 空仓：第一周基准涨则本季度落后，gapToBase = 落后的点数
  const diff = p.quarter.diff;
  assert.ok(Math.abs(p.quarter.gapToBase - Math.max(0, -diff)) < 1e-12);
  assert.equal(p.nextTooFar, !!(p.score.next && p.score.next.need > p.room / 2));
  // 封顶 / 触底：用一个让某季度超额极大/极小的构造（改 benchStart 让基准暴跌/暴涨）
  const up = JSON.parse(JSON.stringify(s)); for (const id of Object.keys(up.benchStart)) up.benchStart[id] *= 0.2;    // 基准起点很低 → 这里让"玩家"看起来基准暴涨
  const pu = Summary.progress(up);
  assert.ok(pu.quarter.score <= Q.min + 1e-9 ? pu.quarter.limit === 'min' : pu.quarter.limit === null);
});

test('quarterNote：赚钱却跑输基准、亏钱却跑赢基准都要讲清楚', () => {
  const Summary = G('summary.js');
  assert.match(Summary.quarterNote(4.58, 6.54), /你赚了.*基准赚了.*少赚 1\.96 点.*没有基础分/);
  assert.match(Summary.quarterNote(-2, -5), /你亏了.*基准亏了.*少亏了 3\.00 点.*仍然拿到基础分/);
  assert.match(Summary.quarterNote(5, 3), /多赚 2\.00 点/);
  assert.match(Summary.quarterNote(-6, -3), /多亏 3\.00 点/);
});

test('结算诊断：最大丢分项 key、反事实用本局数据重算、文案来自预设表', () => {
  const S = G('scoring.js'), Adv = G('advice.js'), c = Config.scoring;
  // 回撤是最大丢分项
  const a = S.summarize([6, 7, 8, 9], 10, 0.3);
  const da = S.diagnose(a);
  assert.equal(da.key, 'drawdown'); assert.ok(Math.abs(da.loss - a.drawdown.penalty) < 1e-9);
  const cfd = da.counterfactuals.find((x) => x.kind === 'drawdown');
  assert.ok(cfd && Math.abs(cfd.total - S.summarize([6, 7, 8, 9], 10, c.drawdown.threshold).total) < 1e-9 && cfd.gain > 0);
  // 季度分是最大丢分项，反事实指向丢得最多的季度
  const b = S.summarize([-9, 6, 6, 6], 5, 0);
  const db = S.diagnose(b);
  assert.equal(db.key, 'quarter'); assert.equal(db.worstQuarter, 1);
  const cfq = db.counterfactuals.find((x) => x.kind === 'quarter');
  assert.equal(cfq.q, 1); assert.ok(Math.abs(cfq.total - S.summarize([0, 6, 6, 6], 5, 0).total) < 1e-9);
  // 终局分
  const dc = S.diagnose(S.summarize([6, 6, 6, 6], -40, 0));
  assert.equal(dc.key, 'final');
  // 没有明显丢分：key = none，没有反事实
  const dn = S.diagnose(S.summarize([6, 9, 7, 8], 12, 0.01));
  assert.equal(dn.key, 'none'); assert.deepEqual(dn.counterfactuals, []);
  // 最多 2 条反事实，且都是提升 ≥ 0.5 的
  const dm = S.diagnose(S.summarize([-6, 3, -1, 8], -4, 0.2));
  assert.ok(dm.counterfactuals.length <= 2 && dm.counterfactuals.every((x) => x.gain >= 0.5));
  // 建议文案在预设表里，每个 key 都有；逻辑文件里不写文案
  for (const k of ['quarter', 'final', 'drawdown', 'none']) assert.ok(Adv.ADVICE[k] && Adv.DRAG_NAME[k]);
  assert.equal(Adv.fill(Adv.COUNTERFACTUAL.quarter, { q: 2, total: '+9.0', grade: 'C' }), '若第 2 季度跑平基准（超额 0 点），总分为 +9.0，等级为 C');
  assert.ok(!/建议|宁可/.test(require('fs').readFileSync(path.join(__dirname, '..', 'js/game/scoring.js'), 'utf8')));
});

test('规则页：评分 ≤ 5 条、每条一句话、数字都在悬停说明里；包含最大回撤定义', () => {
  const vm = require('vm'), fs = require('fs');
  const ctx = vm.createContext({ GameConfig: Config, GameResearch: G('research.js'), console });
  for (const f of ['js/ui/tips.js', 'js/ui/rules.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
  const items = vm.runInContext('GameRules.scoringItems()', ctx);
  assert.ok(items.length >= 1 && items.length <= 5);
  for (const it of items) {
    const shown = it.replace(/<span class="tip[^"]*" tabindex="0" data-tip="[^"]*">ⓘ<\/span>/g, '');          // 去掉悬停说明，只看直接可见的文字
    assert.equal((shown.match(/[。！？]/g) || []).length, 1, '每条一句话：' + shown);
    assert.ok(!/\d/.test(shown), '具体数值应放进悬停说明：' + shown);
    assert.match(it, /data-tip="/);
  }
  const all = items.join('');
  assert.match(all, /最大回撤 ＝ 你的总资产相对基准净值，从最高点回落的最大幅度/);
  const S = Config.scoring;
  for (const n of [S.drawdown.maxPenalty, S.totalMin, S.grades.B, S.quarter.beatBase, S.final.perPoint]) assert.ok(all.includes(String(n)), '悬停说明应含数值 ' + n);
});
