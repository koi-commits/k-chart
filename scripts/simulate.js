#!/usr/bin/env node
/* ============================================
   simulate.js — 平衡测试：随机 bot vs 研究 bot
   用法：node scripts/simulate.js [局数=1000] [起始种子=1]
   不依赖 DOM。两个 bot 使用相同的种子序列，所以面对的市场路径完全一致（配对比较）。
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

// ── Bot 2：研究估值后买入被低估的公司 ──
const ENTRY = 0.02;     // 低于估值多少才开始买
const GAIN = 5;         // 低估幅度 → 目标仓位的斜率
const MAX_W = 0.45;     // 单只上限
const MAX_TOTAL = 0.95; // 总仓位上限
const MIN_TRADE = 0.04; // 低于总资产 4% 的调仓不做（省手续费）

function researchBot() {
  return function act(state) {
    const ids = Object.keys(state.companies);
    // 1) 研究：把本回合全部研究点投给估值最旧（或已过期/没有）的公司
    let s = state;
    const stale = ids.map((id) => {
      const est = Research.getEstimate(state, id);
      return { id, remaining: est ? est.remaining : 0 };
    }).sort((a, b) => a.remaining - b.remaining)[0];
    const r = Research.research(state, stale.id, state.pointsLeft);
    if (!r.error) s = r.state;

    // 2) 用有效估值算目标仓位
    const assets = State.totalAssets(s);
    const target = {};
    for (const id of ids) {
      const est = Research.getEstimate(s, id);
      if (!est) continue; // 没有有效估值：不动
      const px = State.lastClose(s, id);
      const m = Math.log(px / est.estimate); // <0 = 被低估
      target[id] = Math.max(0, Math.min(MAX_W, (-m - ENTRY) * GAIN));
    }
    const sum = Object.values(target).reduce((a, b) => a + b, 0);
    if (sum > MAX_TOTAL) for (const id in target) target[id] *= MAX_TOTAL / sum;

    const orders = [];
    let cashLeft = s.cash;
    const buys = [];
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
    return { research: r.error ? [] : [{ id: stale.id, points: state.pointsLeft }], orders };
  };
}

// 研究动作已在 bot 内部先行结算以便决策；这里只需把订单交给 advanceTurn，
// 同时把研究动作传入（advanceTurn 内部会对原 state 重放同一次研究，结果相同，因为随机流在 state 中）
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
  const rets = [], dds = []; let wins = 0, busts = 0;
  for (let i = 0; i < games; i++) {
    const r = playGame(seed0 + i, makeBot);
    rets.push(r.returnPct); dds.push(r.maxDrawdown * 100);
    if (r.totalAssets >= Config.initialCash * Config.winMultiple) wins++;
    if (r.outcome === 'bankrupt') busts++;
  }
  return { name, rets, mean: mean(rets), median: median(rets), winRate: wins / games * 100, mdd: mean(dds), busts: busts / games * 100 };
}

function main() {
  const games = parseInt(process.argv[2] || '1000', 10);
  const seed0 = parseInt(process.argv[3] || '1', 10);
  const t0 = Date.now();
  const a = run('随机交易 bot', randomBot, games, seed0);
  const b = run('研究 bot', researchBot, games, seed0);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`每个 bot ${games} 局（种子 ${seed0}..${seed0 + games - 1}，两个 bot 面对相同的市场），耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  console.log(pad('', 14) + pad('平均收益率', 12) + pad('收益率中位数', 14) + pad('胜率(≥1.5×)', 13) + pad('平均最大回撤', 14) + '判负率');
  for (const r of [a, b]) {
    console.log(pad(r.name, 14) + pad(r.mean.toFixed(2) + '%', 12) + pad(r.median.toFixed(2) + '%', 14) +
      pad(r.winRate.toFixed(1) + '%', 13) + pad(r.mdd.toFixed(2) + '%', 14) + r.busts.toFixed(1) + '%');
  }
  const diff = a.rets.map((x, i) => b.rets[i] - x);
  const se = std(diff) / Math.sqrt(games);
  console.log(`\n配对差（研究 − 随机）：平均 ${mean(diff).toFixed(2)} 个百分点，标准误 ${se.toFixed(2)}，` +
    `研究 bot 更优的局数占 ${(diff.filter((d) => d > 0).length / games * 100).toFixed(1)}%`);
}

if (require.main === module) main();
module.exports = { playGame, randomBot, researchBot, run };
