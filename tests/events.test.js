// 新闻标题的轻/重措辞必须与实际影响一致（js/game/events.js + config.events.headline）
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const G = (m) => require(path.join(__dirname, '..', 'js', 'game', m));
const Config = G('config.js'), State = G('game-state.js'), Events = G('events.js');
const H = Config.events.headline;

// 承诺幅度的词：轻档词只能出现在轻档标题里，重档词只能出现在重档标题里
const SMALL_WORDS = ['小幅', '影响有限', '略好于', '少量', '边际', '阶段性波动'];
const BIG_WORDS = ['大幅', '显著', '明显', '重大', '可观', '连续涨停', '恶化', '更严'];

const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
const TEMPLATES = [];
for (const c of Events.CARDS) for (const tier of ['strong', 'weak']) for (const tpl of c[tier]) {
  TEMPLATES.push({ card: c.id, kind: c.kind, tier, tpl, re: new RegExp('^' + esc(tpl).replace(/\{name\}|\{industry\}/g, '.+') + '$') });
}
/** 标题 → 它来自哪张卡的哪一档 */
function tierOf(e) {
  const m = TEMPLATES.filter((t) => t.card === e.cardId && t.re.test(e.headline));
  assert.equal(m.length, 1, '标题应唯一对应一个模板：' + e.headline);
  return m[0];
}
const quant = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * (b.length - 1)))]; };
const thr = (kind) => (kind === 'fundamental' ? H.strongVLog : H.strongShift);

test('措辞表：承诺"小"的词只在轻档，承诺"大"的词只在重档', () => {
  for (const t of TEMPLATES) {
    const small = SMALL_WORDS.filter((w) => t.tpl.includes(w)), big = BIG_WORDS.filter((w) => t.tpl.includes(w));
    if (t.tier === 'strong') assert.deepEqual(small, [], `重档标题不应承诺小影响：${t.tpl}`);
    else assert.deepEqual(big, [], `轻档标题不应承诺大影响：${t.tpl}`);
  }
});

test('1000 个种子的全部事件：轻档最大实际影响 < 重档中位数；轻档都低于阈值、重档都达到阈值；承诺幅度的词与实际影响一致', (t) => {
  const by = {};            // kind/tier → 实际影响
  const perCard = {};       // card/tier → 次数
  let events = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    let s = State.newGame(seed);
    while (s.status === 'playing') s = State.advanceTurn(s, {});
    for (const e of s.eventLog) {
      const tp = tierOf(e), mag = Events.impactOf(e.kind, e.effects), k = e.kind + '/' + tp.tier;
      (by[k] = by[k] || []).push(mag);
      perCard[e.cardId + '/' + tp.tier] = (perCard[e.cardId + '/' + tp.tier] || 0) + 1;
      events++;
      // 逐条：档位与阈值一致
      if (tp.tier === 'weak') assert.ok(mag < thr(e.kind), `轻档标题实际影响 ${mag.toFixed(3)} ≥ 阈值：${e.headline}`);
      else assert.ok(mag >= thr(e.kind), `重档标题实际影响 ${mag.toFixed(3)} < 阈值：${e.headline}`);
      if (SMALL_WORDS.some((w) => e.headline.includes(w))) assert.ok(mag < thr(e.kind), `承诺小幅的标题实际影响 ${mag.toFixed(3)}：${e.headline}`);
      if (BIG_WORDS.some((w) => e.headline.includes(w))) assert.ok(mag >= thr(e.kind), `承诺大幅的标题实际影响 ${mag.toFixed(3)}：${e.headline}`);
      // 行业事件：措辞按受影响最大的公司决定，所以轻档措辞不会低估任何一家
      for (const ef of Object.values(e.effects)) if (tp.tier === 'weak') assert.ok(Math.abs(e.kind === 'fundamental' ? ef.vLog : ef.sShift) < thr(e.kind));
    }
  }
  for (const kind of ['fundamental', 'sentiment']) {
    const w = by[kind + '/weak'] || [], s = by[kind + '/strong'] || [];
    assert.ok(w.length > 0 && s.length > 0, kind + ' 两档都应出现');
    assert.ok(Math.max(...w) < quant(s, 0.5), `${kind}：轻档最大 ${Math.max(...w)} 应小于重档中位数 ${quant(s, 0.5)}`);
    const f = (a) => `n=${a.length} 最小 ${quant(a, 0).toFixed(3)} 中位 ${quant(a, 0.5).toFixed(3)} 最大 ${quant(a, 1).toFixed(3)}`;
    t.diagnostic(`${kind === 'fundamental' ? '基本面 |vLog|（乘杠杆后）' : '情绪 |sShift|'} 阈值 ${thr(kind)}　轻档 ${f(w)}　重档 ${f(s)}`);
  }
  t.diagnostic(`共 ${events} 条事件；各卡轻/重次数：` + Events.CARDS.map((c) => `${c.id} ${perCard[c.id + '/weak'] || 0}/${perCard[c.id + '/strong'] || 0}`).join('，'));
});

test('措辞分档不改变价格路径：阈值改成全轻 / 全重，K 线与真实价值完全相同，只有标题不同', () => {
  const run = (seed) => { let s = State.newGame(seed); while (s.status === 'playing') s = State.advanceTurn(s, {}); return s; };
  const orig = { ...H };
  try {
    for (const seed of [3, 1072526242]) {
      H.strongVLog = 0; H.strongShift = 0; const allStrong = run(seed);
      H.strongVLog = 9; H.strongShift = 9; const allWeak = run(seed);
      assert.deepEqual(allStrong.candles, allWeak.candles);
      assert.deepEqual(allStrong.vPath, allWeak.vPath);
      assert.deepEqual(allStrong.eventLog.map((e) => e.effects), allWeak.eventLog.map((e) => e.effects));
      assert.ok(allStrong.eventLog.some((e, i) => e.headline !== allWeak.eventLog[i].headline));
    }
  } finally { Object.assign(H, orig); }
});

test('Codex 报告的种子 1072526242：华岳地产 +0.10 / +0.08 与光储新能 −0.149 不再用轻档措辞', () => {
  let s = State.newGame(1072526242);
  while (s.status === 'playing') s = State.advanceTurn(s, {});
  for (const e of s.eventLog) {
    const mag = Events.impactOf(e.kind, e.effects);
    if (mag >= thr(e.kind)) assert.ok(!SMALL_WORDS.some((w) => e.headline.includes(w)), `${mag.toFixed(3)}：${e.headline}`);
  }
  const big = s.eventLog.filter((e) => e.kind === 'fundamental' && Events.impactOf(e.kind, e.effects) > 0.07);
  assert.ok(big.length > 0);
});
