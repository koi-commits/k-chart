#!/usr/bin/env node
/* ============================================
   analyze-records.js — 分析试玩导出的记录（游戏里"导出本局记录"得到的 JSON）
   用法：node scripts/analyze-records.js <记录文件夹> [--json] [--quiet]
     <记录文件夹>  放着一个或多个 kline-game-seed*.json 的目录（递归读取 *.json）
     --json        输出机器可读的 JSON（每局明细 + 汇总），便于再处理
     --quiet       只输出汇总，不逐局打印
   输出：每局的版本、总分与等级、分数构成、最大回撤、研究点使用、研究估值误差、每回合耗时、
         重新开始次数；以及所有记录的汇总统计（按版本分组 + 全部）。
   兼容旧版本记录：v0.3 之前没有评分，若记录里有各季度超额则按当前 config.scoring 重算并标注"重算"；
   估值误差需要重放这一局（要求记录的 gameVersion 与当前代码一致，且重放结果与记录一致），否则标注"无法重放"。
   ============================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const G = (m) => require(path.join(__dirname, '..', 'js', 'game', m));
const Config = G('config.js'), Scoring = G('scoring.js'), Record = G('record.js');

// ───────── 小工具 ─────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const num = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(d));
const pct = (x, d = 1) => (x == null ? '—' : x.toFixed(d) + '%');
const sg = (x, d = 1) => (x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(d));
const secs = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(1) + 's');
const pad = (s, n) => { s = String(s); let w = 0; for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)); };

/** 递归列出目录下所有 .json 文件（按路径排序） */
function listJson(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJson(p));
    else if (/\.json$/i.test(e.name)) out.push(p);
  }
  return out.sort();
}

// ───────── 单局分析 ─────────
/** 分数构成：优先用记录里的 result.score；旧版本没有就按当前 config 用各季度超额重算 */
function scoreOf(rec) {
  const r = rec.result;
  if (!r) return null;
  if (r.score && r.score.quarters) {
    const s = r.score;
    return { recomputed: false, quarters: s.quarters.map((q) => q.score), quarterExcess: s.quarters.map((q) => q.excess),
      quarterTotal: s.quarterTotal, final: s.final.score, finalExcess: s.final.excess, penalty: s.drawdown.penalty,
      total: s.total, grade: r.grade || s.grade, pass: r.pass != null ? r.pass : s.pass };
  }
  if (Array.isArray(r.quarters) && r.quarters.length && r.quarters[0].diff != null) {
    const diffs = r.quarters.map((q) => q.diff);
    const s = Scoring.summarize(diffs, r.returnPct - r.benchmarkReturnPct, r.maxDrawdown);
    const bust = r.outcome === 'bankrupt';
    return { recomputed: true, quarters: s.quarters.map((q) => q.score), quarterExcess: diffs, quarterTotal: s.quarterTotal,
      final: s.final.score, finalExcess: s.final.excess, penalty: s.drawdown.penalty, total: s.total,
      grade: bust ? 'D' : s.grade, pass: bust ? false : s.pass };
  }
  return null;   // 更早的版本：没有季度数据，无法评分
}

/** 重放这一局，取研究日志（含研究当时的真实价值）。失败返回 {ok:false, reason} */
function tryReplay(rec) {
  if (rec.gameVersion !== Config.gameVersion) return { ok: false, reason: `版本 ${rec.gameVersion || '未标注'} 与当前代码 ${Config.gameVersion} 不同` };
  if (!Array.isArray(rec.turns) || !rec.turns.length) return { ok: false, reason: '没有回合数据' };
  try {
    const s = Record.replay(rec);
    const last = rec.turns[rec.turns.length - 1];
    if (Math.abs(s.equity[s.equity.length - 1].assets - last.assetsAfter) > 0.02) return { ok: false, reason: '重放结果与记录不一致' };
    return { ok: true, state: s };
  } catch (e) { return { ok: false, reason: '重放出错：' + e.message }; }
}

/** 分析一份已解析的记录对象，返回每局明细 */
function analyzeRecord(rec, file) {
  const turns = Array.isArray(rec.turns) ? rec.turns : [];
  const pending = rec.pending && rec.pending.research ? rec.pending.research : [];   // 未结束回合里已做的研究
  const allResearch = [];
  turns.forEach((t) => (t.research || []).forEach((r) => allResearch.push({ turn: t.turn, ...r })));
  pending.forEach((r) => allResearch.push({ turn: turns.length + 1, ...r }));
  const perTurn = Config.research.pointsPerTurn;
  const used = allResearch.reduce((a, r) => a + r.points, 0);
  const available = (turns.length + (rec.result ? 0 : (pending.length ? 1 : 0))) * perTurn;
  const researchedTurns = new Set(allResearch.map((r) => r.turn)).size;
  const byCompany = {};
  allResearch.forEach((r) => { byCompany[r.id] = (byCompany[r.id] || 0) + r.points; });
  const names = {};
  (rec.truth || (rec.result && rec.result.truth) || []).forEach((c) => { if (c && c.id) names[c.id] = c.name || c.id; });
  const nm = (id) => names[id] || id;
  const research = {
    actions: allResearch.length, pointsUsed: used, pointsAvailable: available, useRate: available ? used / available * 100 : null,
    turnsWithResearch: researchedTurns, turnsWithoutResearch: Math.max(0, turns.length - new Set(allResearch.filter((r) => r.turn <= turns.length).map((r) => r.turn)).size),
    byCompany: Object.fromEntries(Object.entries(byCompany).map(([k, v]) => [nm(k), v])), pointsHist: { 1: allResearch.filter((r) => r.points === 1).length, 2: allResearch.filter((r) => r.points === 2).length, 3: allResearch.filter((r) => r.points === 3).length }
  };

  // 估值误差（需重放）
  const rp = tryReplay(rec);
  let estimate = { available: false, reason: rp.reason };
  if (rp.ok) {
    const log = rp.state.researchLog || [];
    const errs = log.map((r) => ({ turn: r.turn, id: r.id, name: nm(r.id), points: r.points, err: (r.estimate / r.trueV - 1) * 100, within: Math.abs(Math.log(r.estimate / r.trueV)) <= r.sigma }));
    estimate = { available: true, n: errs.length, meanAbsErrPct: mean(errs.map((e) => Math.abs(e.err))), biasPct: mean(errs.map((e) => e.err)),
      withinSigmaPct: errs.length ? errs.filter((e) => e.within).length / errs.length * 100 : null, worst: errs.sort((a, b) => Math.abs(b.err) - Math.abs(a.err))[0] || null };
  }

  // 耗时
  const ms = turns.map((t) => t.durationMs).filter((x) => typeof x === 'number');
  const slowIdx = ms.length ? ms.indexOf(Math.max(...ms)) : -1;
  const timing = { turns: ms.length, totalMs: ms.reduce((a, b) => a + b, 0), meanMs: mean(ms), medianMs: median(ms), maxMs: ms.length ? Math.max(...ms) : null,
    maxTurn: slowIdx >= 0 ? turns[slowIdx].turn : null, firstTurnMs: ms.length ? ms[0] : null };

  // 交易活跃度
  const orders = turns.reduce((a, t) => a + (t.orders || []).length, 0);
  const trades = turns.reduce((a, t) => a + (t.trades || []).length, 0);
  const failed = turns.reduce((a, t) => a + (t.failed || []).length, 0);
  const fees = turns.reduce((a, t) => a + (t.trades || []).reduce((x, y) => x + (y.fee || 0), 0), 0);
  const activity = { orders, trades, failed, idleTurns: turns.filter((t) => !(t.orders || []).length && !(t.research || []).length).length,
    noOrderTurns: turns.filter((t) => !(t.orders || []).length).length, fees };

  const r = rec.result;
  return {
    file: file ? path.basename(file) : null, seed: rec.seed, version: rec.gameVersion || '(未标注)', restartCount: rec.restartCount != null ? rec.restartCount : null,
    startedAt: rec.startedAt || null, endedAt: rec.endedAt || null, finished: !!r, turnsPlayed: turns.length,
    outcome: r ? r.outcome : null, totalAssets: r ? r.totalAssets : null, returnPct: r ? r.returnPct : null, benchPct: r ? r.benchmarkReturnPct : null,
    excessPct: r ? r.returnPct - r.benchmarkReturnPct : null, maxDrawdownPct: r ? r.maxDrawdown * 100 : null,
    score: scoreOf(rec), research, estimate, timing, activity
  };
}

function analyzeFile(file) {
  let rec;
  try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { file: path.basename(file), error: '不是合法的 JSON：' + e.message }; }
  if (!rec || rec.format !== 'kline-game-record') return { file: path.basename(file), error: '不是试玩记录（format 不是 kline-game-record）' };
  try { return analyzeRecord(rec, file); } catch (e) { return { file: path.basename(file), error: '分析出错：' + e.message }; }
}

// ───────── 汇总 ─────────
function summarize(games) {
  const done = games.filter((g) => g.finished);
  const scored = done.filter((g) => g.score);
  const gradeDist = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  scored.forEach((g) => { gradeDist[g.score.grade]++; });
  const est = games.filter((g) => g.estimate.available && g.estimate.n);
  const medTurn = games.map((g) => g.timing.medianMs).filter((x) => x != null);
  const restarts = games.map((g) => g.restartCount).filter((x) => x != null);
  const nz = (a, f) => mean(a.map(f).filter((x) => x != null));
  return {
    games: games.length, finished: done.length, unfinished: games.length - done.length, scored: scored.length, recomputedScores: scored.filter((g) => g.score.recomputed).length,
    passRate: scored.length ? scored.filter((g) => g.score.pass).length / scored.length * 100 : null,
    gradeDist, meanTotal: nz(scored, (g) => g.score.total), medianTotal: median(scored.map((g) => g.score.total)),
    meanQuarterTotal: nz(scored, (g) => g.score.quarterTotal), meanFinal: nz(scored, (g) => g.score.final), meanPenalty: nz(scored, (g) => g.score.penalty),
    meanReturnPct: nz(done, (g) => g.returnPct), meanExcessPct: nz(done, (g) => g.excessPct), meanMaxDrawdownPct: nz(done, (g) => g.maxDrawdownPct),
    meanResearchUseRate: nz(games, (g) => g.research.useRate), gamesWithoutResearch: games.filter((g) => g.research.pointsUsed === 0).length,
    estimateGames: est.length, meanAbsEstimateErrPct: nz(est, (g) => g.estimate.meanAbsErrPct), meanEstimateBiasPct: nz(est, (g) => g.estimate.biasPct),
    meanWithinSigmaPct: nz(est, (g) => g.estimate.withinSigmaPct),
    medianTurnSeconds: medTurn.length ? median(medTurn) / 1000 : null, meanTotalMinutes: nz(games, (g) => g.timing.totalMs) != null ? nz(games, (g) => g.timing.totalMs) / 60000 : null,
    meanRestarts: restarts.length ? mean(restarts) : null, maxRestarts: restarts.length ? Math.max(...restarts) : null, gamesWithRestarts: restarts.filter((x) => x > 0).length
  };
}

function analyzeDir(dir) {
  const files = listJson(dir);
  const results = files.map(analyzeFile);
  const games = results.filter((r) => !r.error), errors = results.filter((r) => r.error);
  const byVersion = {};
  games.forEach((g) => { (byVersion[g.version] = byVersion[g.version] || []).push(g); });
  return { dir, games, errors, summary: summarize(games), byVersion: Object.fromEntries(Object.entries(byVersion).map(([v, a]) => [v, summarize(a)])) };
}

// ───────── 文本输出 ─────────
function formatGame(g) {
  const L = [];
  L.push(`■ ${g.file}　版本 ${g.version}　种子 ${g.seed}　重新开始 ${g.restartCount == null ? '—（旧版本无此字段）' : g.restartCount + ' 次'}`);
  L.push(`  ${g.finished ? `已结束（${g.outcome === 'bankrupt' ? '中途判负' : '打完 ' + g.turnsPlayed + ' 回合'}）` : `未结束（已打 ${g.turnsPlayed} 回合）`}　开始 ${g.startedAt || '—'}${g.endedAt ? '　结束 ' + g.endedAt : ''}`);
  if (g.finished) {
    L.push(`  结果：总资产 ¥${Math.round(g.totalAssets).toLocaleString('zh-CN')}　收益率 ${sg(g.returnPct, 2)}%　基准 ${sg(g.benchPct, 2)}%　超额 ${sg(g.excessPct, 2)} 点　最大回撤 ${pct(g.maxDrawdownPct, 2)}`);
    if (g.score) {
      const s = g.score;
      L.push(`  评分：总分 ${sg(s.total)}　等级 ${s.grade}　${s.pass ? '✔ 过关' : '✘ 未过关'}${s.recomputed ? '　（旧版本记录，按当前评分参数重算）' : ''}`);
      L.push(`  构成：季度分 ${s.quarters.map((x) => sg(x)).join(' / ')}（合计 ${sg(s.quarterTotal)}） + 终局分 ${sg(s.final)}（全局超额 ${sg(s.finalExcess, 2)} 点） − 回撤扣分 ${num(s.penalty)}`);
      const pos = Math.max(0, s.quarterTotal + s.final);
      if (s.penalty > 0 && pos > 0) L.push(`  回撤扣分占正分的 ${num(s.penalty / pos * 100, 0)}%；若无回撤扣分总分 ${sg(pos)}`);
    } else L.push('  评分：—（这个版本的记录没有季度数据，无法评分）');
  }
  const r = g.research;
  L.push(`  研究：用了 ${r.pointsUsed}/${r.pointsAvailable} 点（${pct(r.useRate, 0)}），${r.actions} 次研究（1点×${r.pointsHist[1]} 2点×${r.pointsHist[2]} 3点×${r.pointsHist[3]}），${r.turnsWithResearch} 个回合做过研究；按公司：${Object.keys(r.byCompany).map((k) => k + ' ' + r.byCompany[k]).join('，') || '无'}`);
  if (g.estimate.available) {
    const e = g.estimate;
    L.push(`  估值误差：${e.n} 次，平均绝对误差 ${pct(e.meanAbsErrPct)}，偏差 ${sg(e.biasPct)}%，落在 1σ 内 ${pct(e.withinSigmaPct, 0)}${e.worst ? `；最大偏差 第${e.worst.turn}回合 ${e.worst.name} ${sg(e.worst.err)}%` : ''}`);
  } else L.push(`  估值误差：无法重放（${g.estimate.reason}）`);
  const t = g.timing;
  L.push(`  耗时：共 ${num(t.totalMs / 60000)} 分钟，每回合均值 ${secs(t.meanMs)}、中位数 ${secs(t.medianMs)}，最长 ${secs(t.maxMs)}（第 ${t.maxTurn || '—'} 回合），第 1 回合 ${secs(t.firstTurnMs)}`);
  const a = g.activity;
  L.push(`  交易：下单 ${a.orders} 笔，成交 ${a.trades} 笔，未成交/被拒 ${a.failed} 笔，手续费 ¥${num(a.fees, 0)}；无订单回合 ${a.noOrderTurns} 个，完全没操作的回合 ${a.idleTurns} 个`);
  return L.join('\n');
}

function formatSummary(title, s) {
  const L = [`【${title}】${s.games} 局（已结束 ${s.finished}，未结束 ${s.unfinished}；有评分 ${s.scored}${s.recomputedScores ? `，其中旧版本重算 ${s.recomputedScores}` : ''}）`];
  if (s.scored) {
    L.push(`  过关率(≥B) ${pct(s.passRate)}　等级分布 S ${s.gradeDist.S} / A ${s.gradeDist.A} / B ${s.gradeDist.B} / C ${s.gradeDist.C} / D ${s.gradeDist.D}`);
    L.push(`  总分 平均 ${sg(s.meanTotal)} 中位数 ${sg(s.medianTotal)}　构成均值：季度分 ${sg(s.meanQuarterTotal)} + 终局分 ${sg(s.meanFinal)} − 回撤扣分 ${num(s.meanPenalty)}`);
  }
  if (s.finished) L.push(`  平均收益率 ${sg(s.meanReturnPct, 2)}%　平均超额 ${sg(s.meanExcessPct, 2)} 点　平均最大回撤 ${pct(s.meanMaxDrawdownPct, 2)}`);
  L.push(`  研究点使用率 ${pct(s.meanResearchUseRate, 0)}（完全没做研究的局 ${s.gamesWithoutResearch}）　估值误差：可重放 ${s.estimateGames} 局，平均绝对误差 ${pct(s.meanAbsEstimateErrPct)}，偏差 ${sg(s.meanEstimateBiasPct)}%，1σ 内 ${pct(s.meanWithinSigmaPct, 0)}`);
  L.push(`  每回合耗时中位数 ${num(s.medianTurnSeconds)}s　每局平均 ${num(s.meanTotalMinutes)} 分钟　重新开始：平均 ${num(s.meanRestarts, 2)} 次，最多 ${s.maxRestarts == null ? '—' : s.maxRestarts} 次，有重开的局 ${s.gamesWithRestarts}`);
  return L.join('\n');
}

function formatReport(res, opts) {
  const L = [`分析目录：${res.dir}　共读到 ${res.games.length + res.errors.length} 个 JSON，有效记录 ${res.games.length} 份${res.errors.length ? `，${res.errors.length} 份被跳过` : ''}`];
  for (const e of res.errors) L.push(`  ⚠ 跳过 ${e.file}：${e.error}`);
  if (!(opts && opts.quiet)) { L.push(''); res.games.forEach((g) => { L.push(formatGame(g)); L.push(''); }); }
  else L.push('');
  const versions = Object.keys(res.byVersion);
  if (versions.length > 1) versions.sort().forEach((v) => { L.push(formatSummary('版本 ' + v, res.byVersion[v])); L.push(''); });
  L.push(formatSummary(versions.length > 1 ? '汇总（全部版本合计）' : '汇总（版本 ' + (versions[0] || '—') + '）', res.summary));
  return L.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir || args.includes('--help')) {
    console.log('用法：node scripts/analyze-records.js <记录文件夹> [--json] [--quiet]\n  记录文件夹：放着游戏里"导出本局记录"得到的 JSON 的目录（递归读取）');
    process.exit(dir ? 0 : 1);
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error('找不到文件夹：' + dir); process.exit(1); }
  const res = analyzeDir(dir);
  if (args.includes('--json')) console.log(JSON.stringify(res, null, 2));
  else console.log(formatReport(res, { quiet: args.includes('--quiet') }));
}

if (require.main === module) main();
module.exports = { analyzeRecord, analyzeFile, analyzeDir, summarize, formatReport, scoreOf, tryReplay };
