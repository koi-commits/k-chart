// 存档校验（js/ui/save.js 的纯函数 GameSave.check）：旧版本/缺字段的存档不进入游戏、不报错；导出原记录不改版本、不重新计分
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const root = path.join(__dirname, '..');
const G = (m) => require(path.join(root, 'js', 'game', m));
const Config = G('config.js'), State = G('game-state.js'), Record = G('record.js');
const Save = require(path.join(root, 'js', 'ui', 'save.js'));
const RULES = Config.rulesVersion;
const check = (raw) => Save.check(raw, RULES, Record.versionsOf);
/** 把记录改成 0.4.2 之前的旧格式：只有 gameVersion */
const legacy = (rec, gv) => { delete rec.buildVersion; delete rec.rulesVersion; rec.gameVersion = gv; };

/** 打完一局，返回与 app.js 相同结构的存档对象 {state, record, view} */
function finishedSave(seed) {
  let s = State.newGame(seed);
  const rec = Record.create(seed, '2026-01-01T00:00:00.000Z', 0);
  const ids = Object.keys(s.companies);
  while (s.status === 'playing') {
    const orders = s.turn === 1 ? [{ id: ids[0], side: 'buy', shares: 300 }] : [];
    const next = State.advanceTurn(s, { orders });
    Record.commitTurn(rec, { turn: s.turn, orders, durationMs: 1000, newsShown: [], state: next, endedAt: '2026-01-01T00:10:00.000Z' });
    s = next;
  }
  return { state: s, record: rec, view: null };
}
const clone = (x) => JSON.parse(JSON.stringify(x));

test('存档校验：当前版本的完整存档可以加载（含进行中的对局与待执行订单）', () => {
  const d = finishedSave(3);
  const ok = check(JSON.stringify(d));
  assert.equal(ok.ok, true); assert.equal(ok.state.status, 'ended');
  const s = State.newGame(4), rec = Record.create(4, 'x', 0);
  rec.pending.orders.push({ id: Object.keys(s.companies)[0], side: 'buy', lots: 2 });
  const p = check(JSON.stringify({ state: s, record: rec, view: { weeklyTurn: 1 } }));
  assert.equal(p.ok, true); assert.deepEqual(p.record.pending.orders, rec.pending.orders); assert.deepEqual(p.view, { weeklyTurn: 1 });
  assert.equal(check(null), null); assert.equal(check(''), null);
});

test('存档校验：v0.2 已结算存档（没有 result.score）→ 旧版本，不加载、不报错；导出原记录保持 v0.2', () => {
  const d = clone(finishedSave(5));
  legacy(d.record, 'v0.2-playtest');
  delete d.state.result.score; delete d.state.result.grade; delete d.state.result.pass; delete d.state.result.excessDrawdown;
  delete d.record.result.score; delete d.record.restartCount;
  const r = check(JSON.stringify(d));
  assert.equal(r.ok, false); assert.equal(r.reason, 'version'); assert.equal(r.version, 'v0.2-playtest');
  assert.equal(Save.message(r), '此存档来自旧版本 v0.2-playtest（规则版本 0.2），无法在当前版本继续');
  const out = JSON.parse(Save.originalExport(r).text);
  assert.deepEqual(out, d.record);                                   // 原样导出
  assert.equal(out.gameVersion, 'v0.2-playtest'); assert.equal(out.result.score, undefined);   // 不改版本、不补分数
});

test('存档校验：v0.3 存档（没有超额回撤）→ 旧版本，不加载；导出原记录不按新规则重新计分', () => {
  const d = clone(finishedSave(6));
  legacy(d.record, 'v0.3-playtest');
  delete d.state.result.excessDrawdown;
  d.state.result.score.total = 7.5; d.record.result.score.total = 7.5;     // 旧规则下的分数
  const r = check(JSON.stringify(d));
  assert.equal(r.ok, false); assert.equal(r.reason, 'version'); assert.equal(r.version, 'v0.3-playtest');
  assert.match(Save.message(r), /旧版本 v0\.3-playtest/);
  const out = JSON.parse(Save.originalExport(r).text);
  assert.equal(out.gameVersion, 'v0.3-playtest'); assert.equal(out.result.score.total, 7.5);
  assert.deepEqual(out, d.record);
});

test('存档校验：当前版本但缺少关键字段 → 无法加载（不崩溃），并指出缺的字段', () => {
  const base = finishedSave(8);
  const cases = [
    [(d) => { delete d.state.result.score; }, 'state.result.score'],
    [(d) => { delete d.state.result.excessDrawdown; }, 'state.result.excessDrawdown'],
    [(d) => { delete d.state.result; }, 'state.result'],
    [(d) => { delete d.state.candles; }, 'state.candles'],
    [(d) => { d.state.equity = []; }, 'state.equity'],
    [(d) => { delete d.record.turns; }, 'record.turns'],
    [(d) => { d.record.pending.orders = 'x'; }, 'record.pending.orders'],
    [(d) => { d.record.seed = 1; }, 'record.seed'],
    [(d) => { d.state.version = 1; }, 'state.version']
  ];
  for (const [mut, field] of cases) {
    const d = clone(base); mut(d);
    const r = check(JSON.stringify(d));
    assert.equal(r.ok, false, field); assert.equal(r.reason, 'broken'); assert.equal(r.field, field);
    assert.match(Save.message(r), /缺少关键数据.*无法在当前版本继续/);
    assert.equal(JSON.parse(Save.originalExport(r).text).rulesVersion, RULES);
  }
  // 没有 record：版本未知，按旧版本处理；导出整个存档原文
  const nr = clone(base); delete nr.record;
  const r1 = check(JSON.stringify(nr));
  assert.equal(r1.ok, false); assert.equal(r1.reason, 'version'); assert.match(Save.message(r1), /未标注版本/);
  assert.equal(Save.originalExport(r1).text, JSON.stringify(nr));
  // 不是合法 JSON
  const r2 = check('{"state":');
  assert.equal(r2.ok, false); assert.equal(r2.reason, 'corrupt'); assert.equal(Save.originalExport(r2).text, '{"state":');
});

test('存档兼容：规则版本相同、程序版本不同的存档可以正常加载（含 v0.4 / v0.4.1 旧格式存档）', () => {
  const mid = () => {                                       // 进行到一半的对局
    let s = State.newGame(9); const rec = Record.create(9, 'x', 0);
    for (let i = 0; i < 3; i++) { const n = State.advanceTurn(s, {}); Record.commitTurn(rec, { turn: s.turn, orders: [], durationMs: 1, newsShown: [], state: n }); s = n; }
    return { state: s, record: rec, view: null };
  };
  const a = clone(mid()); a.record.buildVersion = RULES + '.0-older';                    // 新格式，程序版本不同
  const b = clone(mid()); legacy(b.record, 'v' + RULES + '-playtest');                 // 旧格式 v0.4-playtest
  const c = clone(mid()); legacy(c.record, 'v' + RULES + '.1-playtest');               // 旧格式 v0.4.1-playtest
  const e = clone(finishedSave(10)); e.record.buildVersion = RULES + '.99-future';      // 已结算的局
  for (const d of [a, b, c, e]) {
    const r = check(JSON.stringify(d));
    assert.equal(r.ok, true, JSON.stringify({ build: d.record.buildVersion || d.record.gameVersion, reason: r.reason }));
    assert.deepEqual(r.record, d.record);                    // 原样恢复，不改版本号
  }
});

test('存档兼容：规则版本不同的存档按旧存档处理（不论程序版本）', () => {
  const a = clone(finishedSave(11)); a.record.rulesVersion = '0.3';                      // 程序版本与当前相同，规则版本不同
  const b = clone(finishedSave(12)); b.record.rulesVersion = '9.9';
  const c = clone(finishedSave(13)); legacy(c.record, 'v0.3-playtest');
  const d = clone(finishedSave(14)); delete d.record.buildVersion; delete d.record.rulesVersion;   // 没有任何版本号
  for (const [x, rules] of [[a, '0.3'], [b, '9.9'], [c, '0.3'], [d, null]]) {
    const r = check(JSON.stringify(x));
    assert.equal(r.ok, false); assert.equal(r.reason, 'version'); assert.equal(r.rules, rules);
    assert.match(Save.message(r), /此存档来自旧版本 .*无法在当前版本继续/);
    assert.deepEqual(JSON.parse(Save.originalExport(r).text), x.record);
  }
  assert.match(Save.message(check(JSON.stringify(a))), new RegExp(`旧版本 v${Config.buildVersion.replace(/\./g, '\\.')}（规则版本 0\\.3）`));
});
