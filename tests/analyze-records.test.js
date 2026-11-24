// scripts/analyze-records.js 的测试：造一批记录（含旧版本、未结束、坏文件、子目录），检查每局明细与汇总
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const G = (m) => require(path.join(root, 'js', 'game', m));
const Config = G('config.js'), State = G('game-state.js'), Research = G('research.js'), Record = G('record.js');
const A = require(path.join(root, 'scripts', 'analyze-records.js'));

/** 按 actions 打一局并生成记录（与 app.js 的记录方式一致）；stopAfter 指定只打几回合（未结束） */
function makeRecord(seed, { research = {}, buy = true, stopAfter = 99, restartCount = 0, durationMs = 2000 } = {}) {
  let s = State.newGame(seed);
  const rec = Record.create(seed, '2026-01-01T00:00:00.000Z', restartCount);
  const ids = Object.keys(s.companies);
  let played = 0;
  while (s.status === 'playing' && played < stopAfter) {
    let cur = s;
    for (const [turn, pts] of Object.entries(research)) {
      if (+turn === s.turn) { const id = ids[s.turn % ids.length]; const r = Research.research(cur, id, pts); cur = r.state; rec.pending.research.push({ id, points: pts, estimate: cur.research[id].estimate, sigma: cur.research[id].sigma }); }
    }
    const orders = buy && s.turn === 1 ? [{ id: ids[0], side: 'buy', shares: 300 }] : [];
    const next = State.advanceTurn(cur, { orders });
    Record.commitTurn(rec, { turn: s.turn, orders, durationMs, newsShown: s.news.map((n) => n.headline), state: next, endedAt: '2026-01-01T00:10:00.000Z' });
    s = next; played++;
  }
  return rec;
}

function fixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kline-analyze-'));
  const w = (name, obj) => { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj)); };
  const g1 = makeRecord(11, { research: { 1: 3, 2: 2 }, restartCount: 2, durationMs: 3000 });
  const g2 = makeRecord(12, { research: {}, buy: false, restartCount: 0, durationMs: 1000 });
  const g3 = makeRecord(13, { research: { 1: 1 }, stopAfter: 6 });                       // 未结束
  const old = JSON.parse(JSON.stringify(makeRecord(14, { research: { 3: 3 } })));         // 伪造 v0.2：没有 score/grade/pass、没有 restartCount
  delete old.buildVersion; delete old.rulesVersion; old.gameVersion = 'v0.2-playtest'; delete old.restartCount; delete old.result.score; delete old.result.grade; delete old.result.pass;
  w('a/g1.json', g1); w('g2.json', g2); w('g3-unfinished.json', g3); w('old-v02.json', old);
  w('broken.json', '{ not json'); w('other.json', { hello: 'world' }); w('readme.txt', 'ignored');
  return { dir, g1, g2, g3, old };
}

test('analyzeDir：读取有效记录、跳过坏文件、递归子目录', () => {
  const { dir } = fixtureDir();
  const res = A.analyzeDir(dir);
  assert.equal(res.games.length, 4);
  assert.equal(res.errors.length, 2);                                   // 坏 JSON + format 不对；.txt 不读
  assert.ok(res.errors.some((e) => /不是合法的 JSON/.test(e.error)) && res.errors.some((e) => /不是试玩记录/.test(e.error)));
  assert.deepEqual(Object.keys(res.byVersion).sort(), ['v0.2-playtest', 'v' + Config.buildVersion].sort());
});

test('单局明细：版本、重开次数、分数构成与等级、耗时、研究点', () => {
  const { dir, g1 } = fixtureDir();
  const g = A.analyzeDir(dir).games.find((x) => x.file === 'g1.json');
  assert.equal(g.version, 'v' + Config.buildVersion); assert.equal(g.rulesVersion, Config.rulesVersion); assert.equal(g.restartCount, 2); assert.equal(g.seed, 11);
  assert.equal(g.finished, true);
  const s = g1.result.score;
  assert.ok(Math.abs(g.score.total - s.total) < 1e-9); assert.equal(g.score.grade, g1.result.grade);
  assert.deepEqual(g.score.quarters.map((x) => +x.toFixed(6)), s.quarters.map((q) => +q.score.toFixed(6)));
  assert.ok(Math.abs(g.score.penalty - s.drawdown.penalty) < 1e-9); assert.equal(g.score.recomputed, false);
  assert.ok(Math.abs(g.maxDrawdownPct - g1.result.maxDrawdown * 100) < 1e-9);
  assert.equal(g.timing.totalMs, 3000 * 20); assert.equal(g.timing.medianMs, 3000); assert.equal(g.timing.turns, 20);
  assert.equal(g.research.pointsUsed, 5); assert.equal(g.research.actions, 2);                      // 3 点 + 2 点
  assert.equal(g.research.pointsAvailable, 20 * Config.research.pointsPerTurn);
  assert.equal(g.research.turnsWithResearch, 2); assert.equal(g.research.turnsWithoutResearch, 18);
  assert.deepEqual(g.research.pointsHist, { 1: 0, 2: 1, 3: 1 });
  assert.equal(g.activity.orders, 1); assert.equal(g.activity.trades, 1);
});

test('研究估值误差：同版本记录重放后与真实价值比较；不同版本无法重放', () => {
  const { dir, g1 } = fixtureDir();
  const res = A.analyzeDir(dir);
  const g = res.games.find((x) => x.file === 'g1.json');
  assert.equal(g.estimate.available, true); assert.equal(g.estimate.n, 2);
  // 独立计算：重放得到研究日志，逐条比较
  const log = Record.replay(g1).researchLog;
  const abs = log.map((r) => Math.abs(r.estimate / r.trueV - 1) * 100);
  assert.ok(Math.abs(g.estimate.meanAbsErrPct - abs.reduce((a, b) => a + b, 0) / abs.length) < 1e-9);
  const old = res.games.find((x) => x.file === 'old-v02.json');
  assert.equal(old.estimate.available, false); assert.match(old.estimate.reason, /版本/);
});

test('旧版本记录：没有评分的按当前参数用各季度超额重算，并标注', () => {
  const { dir, old } = fixtureDir();
  const g = A.analyzeDir(dir).games.find((x) => x.file === 'old-v02.json');
  assert.equal(g.version, 'v0.2-playtest'); assert.equal(g.restartCount, null);
  assert.equal(g.score.recomputed, true);
  // 参数没变，所以重算结果应等于原来的总分（用同一局的原始 score 对照）
  const orig = makeRecord(14, { research: { 3: 3 } }).result.score;
  assert.ok(Math.abs(g.score.total - orig.total) < 1e-9);
  assert.match(A.formatReport(A.analyzeDir(dir)), /规则版本不同的旧记录，按当前规则重算/);
});

test('版本：规则版本相同、程序版本不同的记录照常直接分析；规则版本不同的（含 v0.4.x 旧记录）才重算', () => {
  const rec = makeRecord(15, { research: { 1: 3 } });
  const a = JSON.parse(JSON.stringify(rec)); a.buildVersion = Config.rulesVersion + '.0-older';                   // 程序版本不同
  const b = JSON.parse(JSON.stringify(rec)); b.buildVersion = '9.0.0-future';                                         // 程序版本不同（更新）
  const c = JSON.parse(JSON.stringify(rec)); c.rulesVersion = '0.0';                                                 // 规则版本不同
  const d = JSON.parse(JSON.stringify(rec)); delete d.buildVersion; delete d.rulesVersion; d.gameVersion = 'v0.4.1-playtest';   // 旧格式 v0.4.1（规则 0.4）
  for (const [r, same] of [[a, true], [b, true], [c, false], [d, Config.rulesVersion === '0.4']]) {
    const g = A.analyzeRecord(r, 'x.json');
    assert.equal(g.score.recomputed, !same);
    assert.equal(g.estimate.available, same, JSON.stringify(g.estimate));
    if (same) assert.ok(Math.abs(g.score.total - rec.result.score.total) < 1e-9);
  }
  assert.match(A.analyzeRecord(c, 'x.json').estimate.reason, /规则版本 0\.0/);
});

test('未结束的局：不进评分汇总，但研究/耗时照常统计', () => {
  const { dir } = fixtureDir();
  const res = A.analyzeDir(dir);
  const g = res.games.find((x) => x.file === 'g3-unfinished.json');
  assert.equal(g.finished, false); assert.equal(g.turnsPlayed, 6); assert.equal(g.score, null);
  assert.equal(g.research.pointsUsed, 1);
  assert.equal(res.summary.games, 4); assert.equal(res.summary.finished, 3); assert.equal(res.summary.unfinished, 1); assert.equal(res.summary.scored, 3);
});

test('汇总：过关率、等级分布、平均总分、重新开始统计', () => {
  const { dir } = fixtureDir();
  const res = A.analyzeDir(dir), s = res.summary;
  const scored = res.games.filter((g) => g.score);
  assert.equal(scored.length, 3);
  assert.ok(Math.abs(s.meanTotal - scored.reduce((a, g) => a + g.score.total, 0) / 3) < 1e-9);
  assert.equal(Object.values(s.gradeDist).reduce((a, b) => a + b, 0), 3);
  assert.ok(Math.abs(s.passRate - scored.filter((g) => g.score.pass).length / 3 * 100) < 1e-9);
  assert.equal(s.maxRestarts, 2); assert.equal(s.gamesWithRestarts, 1);        // 旧版本没有该字段，不参与
  assert.equal(s.gamesWithoutResearch, 1);                                      // g2 没做研究
  assert.equal(res.byVersion['v' + Config.buildVersion].games, 3); assert.equal(res.byVersion['v0.2-playtest'].games, 1);
});

test('命令行：文本报告包含关键字段；--json 可解析；缺少参数/不存在的目录报错', () => {
  const { dir } = fixtureDir();
  const script = path.join(root, 'scripts', 'analyze-records.js');
  const out = execFileSync('node', [script, dir], { encoding: 'utf8' });
  for (const k of ['总分', '等级', '回撤扣分', '研究：', '估值误差', '耗时', '重新开始', '汇总', '过关率']) assert.ok(out.includes(k), `缺少 ${k}`);
  const j = JSON.parse(execFileSync('node', [script, dir, '--json'], { encoding: 'utf8' }));
  assert.equal(j.games.length, 4); assert.ok(j.summary && j.byVersion);
  const q = execFileSync('node', [script, dir, '--quiet'], { encoding: 'utf8' });
  assert.ok(!q.includes('■ ') && q.includes('汇总'));
  assert.throws(() => execFileSync('node', [script], { stdio: 'pipe' }));
  assert.throws(() => execFileSync('node', [script, path.join(dir, 'nope')], { stdio: 'pipe' }));
});
