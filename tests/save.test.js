// 存档校验（js/ui/save.js 的纯函数 GameSave.check）：旧版本/缺字段的存档不进入游戏、不报错；导出原记录不改版本、不重新计分
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const root = path.join(__dirname, '..');
const G = (m) => require(path.join(root, 'js', 'game', m));
const Config = G('config.js'), State = G('game-state.js'), Record = G('record.js');
const Save = require(path.join(root, 'js', 'ui', 'save.js'));
const CUR = Config.gameVersion;

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

test('存档校验：当前版本的完整存档可以加载（含进行中的对局）', () => {
  const d = finishedSave(3);
  const ok = Save.check(JSON.stringify(d), CUR);
  assert.equal(ok.ok, true); assert.equal(ok.state.status, 'ended');
  const s = State.newGame(4), rec = Record.create(4, 'x', 0);
  const p = Save.check(JSON.stringify({ state: s, record: rec }), CUR);
  assert.equal(p.ok, true); assert.equal(p.state.turn, 1);
  assert.equal(Save.check(null, CUR), null); assert.equal(Save.check('', CUR), null);
});

test('存档校验：v0.2 已结算存档（没有 result.score）→ 旧版本，不加载、不报错；导出原记录保持 v0.2', () => {
  const d = clone(finishedSave(5));
  d.record.gameVersion = 'v0.2-playtest';
  delete d.state.result.score; delete d.state.result.grade; delete d.state.result.pass; delete d.state.result.excessDrawdown;
  delete d.record.result.score; delete d.record.restartCount;
  const r = Save.check(JSON.stringify(d), CUR);
  assert.equal(r.ok, false); assert.equal(r.reason, 'version'); assert.equal(r.version, 'v0.2-playtest');
  assert.equal(Save.message(r), '此存档来自旧版本 v0.2-playtest，无法在当前版本继续');
  const out = JSON.parse(Save.originalExport(r).text);
  assert.deepEqual(out, d.record);                                   // 原样导出
  assert.equal(out.gameVersion, 'v0.2-playtest'); assert.equal(out.result.score, undefined);   // 不改版本、不补分数
});

test('存档校验：v0.3 存档（没有超额回撤）→ 旧版本，不加载；导出原记录不按新规则重新计分', () => {
  const d = clone(finishedSave(6));
  d.record.gameVersion = 'v0.3-playtest';
  delete d.state.result.excessDrawdown;
  d.state.result.score.total = 7.5; d.record.result.score.total = 7.5;     // 旧规则下的分数
  const r = Save.check(JSON.stringify(d), CUR);
  assert.equal(r.ok, false); assert.equal(r.reason, 'version'); assert.equal(r.version, 'v0.3-playtest');
  assert.match(Save.message(r), /旧版本 v0\.3-playtest/);
  const out = JSON.parse(Save.originalExport(r).text);
  assert.equal(out.gameVersion, 'v0.3-playtest'); assert.equal(out.result.score.total, 7.5);
  assert.deepEqual(out, d.record);
  // 版本与当前不同时，即使字段齐全也不进入游戏（例如上一个 v0.4 的存档）
  const d2 = clone(finishedSave(7)); d2.record.gameVersion = 'v0.4-playtest';
  if (CUR !== 'v0.4-playtest') assert.equal(Save.check(JSON.stringify(d2), CUR).reason, 'version');
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
    [(d) => { d.record.seed = 1; }, 'record.seed'],
    [(d) => { d.state.version = 1; }, 'state.version']
  ];
  for (const [mut, field] of cases) {
    const d = clone(base); mut(d);
    const r = Save.check(JSON.stringify(d), CUR);
    assert.equal(r.ok, false, field); assert.equal(r.reason, 'broken'); assert.equal(r.field, field);
    assert.match(Save.message(r), /缺少关键数据.*无法在当前版本继续/);
    assert.equal(JSON.parse(Save.originalExport(r).text).gameVersion, CUR);
  }
  // 没有 record：版本未知，按旧版本处理；导出整个存档原文
  const nr = clone(base); delete nr.record;
  const r1 = Save.check(JSON.stringify(nr), CUR);
  assert.equal(r1.ok, false); assert.equal(r1.reason, 'version'); assert.match(Save.message(r1), /未标注版本/);
  assert.equal(Save.originalExport(r1).text, JSON.stringify(nr));
  // 不是合法 JSON
  const r2 = Save.check('{"state":', CUR);
  assert.equal(r2.ok, false); assert.equal(r2.reason, 'corrupt'); assert.equal(Save.originalExport(r2).text, '{"state":');
});
