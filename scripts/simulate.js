#!/usr/bin/env node
/* ============================================
   simulate.js — 平衡测试：研究 bot vs 随机估值 / 随机交易 / 等权持有 / 押单一公司
   用法：node scripts/simulate.js [局数=1000] [起始种子=1]
   不依赖 DOM。所有 bot 使用相同的种子序列，所以面对的市场与公司参数完全一致（配对比较）。
   bot 只使用玩家可见信息（K线、现金、持仓、研究估值），不读取隐藏的 V。
   ============================================ */
const path = require('path');
const G = (m) => require(path.join(__dirname, '..', 'js', 'game', m));
const Config = G('config.js'), Rng = G('rng.js'), State = G('game-state.js'),
  Research = G('research.js'), Trading = G('trading.js');

const LOT = Config.lotSize;

// ── Bot 1：随机交易 ──
function randomBot(seed) {
  const rng = Rng.create(Rng.deriveState(seed, 99));
  return function act(state) {
    const ids = Object.keys(state.companies);
    const orders = [];
    const n = rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      const id = rng.pick(ids);
      const px = State.lastClose(state, id);
      const pos = state.positions[id];
      const wantSell = pos && rng.chance(0.5);
      if (wantSell) {
        const lots = Math.max(1, Math.floor((pos.shares / LOT) * rng.uniform(0.3, 1)));
        orders.push({ id, side: 'sell', shares: lots * LOT });
      } else {
        const budget = state.cash * rng.uniform(0.1, 0.4);
        const lots = Math.floor(Trading.maxAffordable(budget / 1.01, px) / LOT);
        if (lots >= 1) orders.push({ id, side: 'buy', shares: lots * LOT });
      }
    }
    return { orders };
  };
}

// ── 研究 bot / 随机估值 bot 共用的交易逻辑 ──
// 两者唯一的区别是"估值从哪来"：research bot 用研究得到的估值，random-valuation bot 用随机数。
const ENTRY = 0.02;     // 低于估值多少才开始买
const GAIN = 5;         // 低估幅度 → 目标仓位的斜率
const MAX_W = 0.45;     // 单只上限
const MAX_TOTAL = 0.95; // 总仓位上限
const MIN_TRADE = 0.04; // 低于总资产 4% 的调仓不做（省手续费）

/** estimateOf(id) → {estimate, remaining} | null；返回订单列表 */
function tradeOnEstimates(s, estimateOf) {
  const ids = Object.keys(s.companies);
  const assets = State.totalAssets(s);
  const target = {};
  for (const id of ids) {
    const est = estimateOf(id);
    if (!est) continue; // 没有有效估值：不动
    const m = Math.log(State.lastClose(s, id) / est.estimate); // <0 = 被低估
    target[id] = Math.max(0, Math.min(MAX_W, (-m - ENTRY) * GAIN));
  }
  const sum = Object.values(target).reduce((x, y) => x + y, 0);
  if (sum > MAX_TOTAL) for (const id in target) target[id] *= MAX_TOTAL / sum;

  const orders = [], buys = [];
  let cashLeft = s.cash;
  for (const id in target) {
    const px = State.lastClose(s, id);
    const have = (s.positions[id] ? s.positions[id].shares : 0) * px;
    const diff = target[id] * assets - have;
    if (Math.abs(diff) < MIN_TRADE * assets && !(target[id] === 0 && have > 0)) continue;
    if (diff < 0) {
      const shares = Math.min(s.positions[id].shares, Math.ceil(-diff / px / LOT) * LOT);
      if (shares >= LOT) { orders.push({ id, side: 'sell', shares }); cashLeft += shares * px * 0.99; }
    } else buys.push({ id, px, diff });
  }
  for (const b of buys) {
    const lots = Math.floor(Math.min(b.diff, cashLeft) / 1.01 / b.px / LOT);
    if (lots >= 1) { orders.push({ id: b.id, side: 'buy', shares: lots * LOT }); cashLeft -= lots * LOT * b.px * 1.01; }
  }
  return orders;
}

/** 每回合轮转研究：把全部研究点投给估值最旧（或已过期/没有）的公司 */
function pickStalest(ids, remainingOf) {
  return ids.map((id) => ({ id, remaining: remainingOf(id) })).sort((x, y) => x.remaining - y.remaining)[0].id;
}

// ── Bot 2：研究估值后买入被低估的公司 ──
function researchBot() {
  return function act(state) {
    const ids = Object.keys(state.companies);
    const id = pickStalest(ids, (i) => { const e = Research.getEstimate(state, i); return e ? e.remaining : 0; });
    const r = Research.research(state, id, state.pointsLeft);
    const s = r.error ? state : r.state;
    // 研究动作同时交给 advanceTurn；它在原 state 上重放同一次研究，结果相同（随机流在 state 里）
    return { research: r.error ? [] : [{ id, points: state.pointsLeft }], orders: tradeOnEstimates(s, (i) => Research.getEstimate(s, i)) };
  };
}

// ── Bot 3：随机估值 bot —— 交易逻辑与研究 bot 完全相同，估值换成随机数 ──
// 随机估值 = 研究当时的价格 × exp(N(0, 0.15))，与真实价值无关；同样每回合轮转一家、4 回合过期。
const FAKE_SIGMA = 0.15;
function randomValuationBot(seed) {
  const rng = Rng.create(Rng.deriveState(seed, 98));
  const fake = {}; // id -> {estimate, turn}
  const R = Config.research;
  const get = (state, id) => {
    const f = fake[id];
    if (!f) return null;
    const age = state.turn - f.turn;
    return age >= R.validTurns ? null : { estimate: f.estimate, remaining: R.validTurns - age };
  };
  return function act(state) {
    const ids = Object.keys(state.companies);
    const id = pickStalest(ids, (i) => { const e = get(state, i); return e ? e.remaining : 0; });
    fake[id] = { estimate: State.lastClose(state, id) * Math.exp(FAKE_SIGMA * rng.normal()), turn: state.turn };
    return { orders: tradeOnEstimates(state, (i) => get(state, i)) };
  };
}

// ── Bot 4：等权持有 —— 第 1 回合平均买入 4 家，之后不再操作 ──
function equalWeightBot() {
  return function act(state) {
    if (state.turn !== 1) return {};
    const ids = Object.keys(state.companies);
    const orders = [];
    for (const id of ids) {
      const lots = Math.floor(Trading.maxAffordable(state.cash / ids.length / 1.01, State.lastClose(state, id)) / LOT);
      if (lots >= 1) orders.push({ id, side: 'buy', shares: lots * LOT });
    }
    return { orders };
  };
}

// ── Bot 5：押单一公司 —— 第 1 回合全仓某一家，之后不再操作 ──
function singleBot(targetId) {
  return function () {
    return function act(state) {
      if (state.turn !== 1) return {};
      const lots = Math.floor(Trading.maxAffordable(state.cash / 1.01, State.lastClose(state, targetId)) / LOT);
      return lots >= 1 ? { orders: [{ id: targetId, side: 'buy', shares: lots * LOT }] } : {};
    };
  };
}

function playGame(seed, makeBot) {
  let s = State.newGame(seed);
  const act = makeBot(seed);
  while (s.status === 'playing') s = State.advanceTurn(s, act(s));
  return s.result;
}

function median(a) { const b = a.slice().sort((x, y) => x - y); const n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

function run(name, makeBot, games, seed0) {
  const rets = [], dds = [], bench = []; let wins = 0, busts = 0;
  for (let i = 0; i < games; i++) {
    const r = playGame(seed0 + i, makeBot);
    rets.push(r.returnPct); dds.push(r.maxDrawdown * 100); bench.push(r.benchmarkReturnPct);
    if (r.win) wins++;
    if (r.outcome === 'bankrupt') busts++;
  }
  return { name, rets, mean: mean(rets), median: median(rets), winRate: wins / games * 100, mdd: mean(dds), busts: busts / games * 100, benchMean: mean(bench) };
}

/** 配对差 a − b：{mean, se} */
function paired(a, b) {
  const d = a.rets.map((x, i) => x - b.rets[i]);
  return { mean: mean(d), se: std(d) / Math.sqrt(d.length), better: d.filter((x) => x > 0).length / d.length * 100 };
}

function main() {
  const games = parseInt(process.argv[2] || '1000', 10);
  const seed0 = parseInt(process.argv[3] || '1', 10);
  const t0 = Date.now();
  const ids = Object.keys(State.newGame(seed0).companies);
  const g0 = State.newGame(seed0), names = {}; for (const id of ids) names[id] = g0.companies[id].name;

  const R = {
    research: run('研究 bot', researchBot, games, seed0),
    randval: run('随机估值 bot', randomValuationBot, games, seed0),
    random: run('随机交易 bot', randomBot, games, seed0),
    equal: run('等权持有 bot', equalWeightBot, games, seed0)
  };
  const singles = ids.map((id) => run('押' + names[id], singleBot(id), games, seed0));

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`每个 bot ${games} 局（种子 ${seed0}..${seed0 + games - 1}，所有 bot 面对相同的市场与相同的公司参数），耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`胜利条件：打完 ${Config.totalTurns} 回合且收益率 ≥ 等权持有基准 + ${Config.winMarginPct} 个百分点；基准平均收益 ${R.equal.benchMean.toFixed(2)}%\n`);
  console.log(pad('', 16) + pad('平均收益率', 12) + pad('收益率中位数', 14) + pad('胜率', 9) + pad('平均最大回撤', 14) + pad('判负率', 8) + '对等权配对差(±标准误)');
  for (const r of [R.research, R.randval, R.random, R.equal, ...singles]) {
    const pd = paired(r, R.equal);
    console.log(pad(r.name, 16) + pad(r.mean.toFixed(2) + '%', 12) + pad(r.median.toFixed(2) + '%', 14) + pad(r.winRate.toFixed(1) + '%', 9) +
      pad(r.mdd.toFixed(2) + '%', 14) + pad(r.busts.toFixed(1) + '%', 8) + (r === R.equal ? '—' : `${pd.mean >= 0 ? '+' : ''}${pd.mean.toFixed(2)} ±${pd.se.toFixed(2)}`));
  }

  // ── 验收 ──
  const pv = paired(R.research, R.randval);
  const others = [R.randval, R.random, R.equal, ...singles];
  const check = (ok, label, detail) => console.log(`${ok ? '✔' : '✘'} ${label}  ${detail}`);
  console.log(`\n验收：`);
  check(others.every((o) => R.research.mean > o.mean), '研究 bot 平均收益率高于所有其他 bot',
    `（研究 ${R.research.mean.toFixed(2)}%，其他最高 ${Math.max(...others.map((o) => o.mean)).toFixed(2)}%）`);
  check(pv.mean >= 5, '研究 bot 相对随机估值 bot 的配对差 ≥ 5 个百分点', `（${pv.mean.toFixed(2)} ±${pv.se.toFixed(2)}，研究更优局数 ${pv.better.toFixed(1)}%）`);
  const worst = singles.map((s) => ({ s, p: paired(s, R.equal) })).sort((x, y) => y.p.mean - x.p.mean)[0];
  check(singles.every((s) => { const p = paired(s, R.equal); return p.mean < 2 * p.se; }), '任何押单一公司 bot 都不显著高于等权持有（配对差 < 2 倍标准误）',
    `（最高：${worst.s.name} ${worst.p.mean >= 0 ? '+' : ''}${worst.p.mean.toFixed(2)} ±${worst.p.se.toFixed(2)}）`);
  check(R.research.winRate >= 35 && R.research.winRate <= 60, '研究 bot 胜率在 35%–60%', `（${R.research.winRate.toFixed(1)}%）`);
  check([R.equal, R.random, R.randval].every((r) => r.winRate <= 15), '等权持有 / 随机交易 / 随机估值 bot 胜率 ≤ 15%',
    `（${R.equal.winRate.toFixed(1)}% / ${R.random.winRate.toFixed(1)}% / ${R.randval.winRate.toFixed(1)}%）`);
}

if (require.main === module) main();
module.exports = { playGame, randomBot, researchBot, randomValuationBot, equalWeightBot, singleBot, run };
