// 端到端测试（Playwright，真实界面）：npm run test:e2e
// 1) 三种窗口尺寸下各打完一局：所有弹窗的按钮都看得见、点得到（截图在 test-results/e2e/）
// 2) 仓库自带的 AI 试玩记录按当前规则重放成存档后，结算页按钮可见可点
// 3) 旧版本 / 缺字段存档：不进入游戏、不报错，可原样导出原记录、可开始新局
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');
const G = (m) => require(path.join(H.ROOT, 'js', 'game', m));
const Config = G('config.js'), State = G('game-state.js'), Record = G('record.js');
const SAVE_KEY = 'kline-game-v0-save', RULES_KEY = 'kline-game-v0-rules-seen';

const SIZES = [{ width: 1280, height: 800 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }];
const skip = H.playwright ? false : '没有安装 Playwright，跳过端到端测试';
let browser;
test.before(async () => { if (!skip) browser = await H.launch(); });
test.after(async () => { if (browser) await browser.close(); });

/** 页面加载前写入存档（只在第一次加载时写，之后刷新用页面自己的存档） */
const injectSave = (save, rulesSeen = true) => (page) => page.addInitScript(([k, v, rk, seen]) => {
  if (sessionStorage.getItem('__injected')) return;
  sessionStorage.setItem('__injected', '1');
  localStorage.setItem(k, v);
  if (seen) localStorage.setItem(rk, '1');
}, [SAVE_KEY, JSON.stringify(save), RULES_KEY, rulesSeen]);

async function expectClickable(page, sel, label) {
  const r = await H.clickable(page, sel);
  assert.ok(r.ok, `${label}：按钮看不见或点不到 → ${r.why}`);
}

/** 弹窗卡片：滚到顶、滚到底时按钮都要可见可点 */
async function checkCard(page, overlay, btns, label) {
  for (const where of ['top', 'bottom']) {
    await H.scrollCard(page, overlay, where);
    for (const b of btns) await expectClickable(page, `${overlay} ${b}`, `${label}（卡片滚到${where === 'top' ? '顶' : '底'}）`);
  }
  await H.scrollCard(page, overlay, 'top');
}

async function waitAny(page, sels, timeout = 15000) {
  await page.waitForFunction((ss) => ss.some((s) => { const el = document.querySelector(s); return el && !el.hidden; }), sels, { timeout });
}

/**
 * 在当前页面把对局打到结算页。check=true 时检查每类弹窗的按钮，并给每类弹窗截一张图。
 * hooks.onTurn(turn) 在每回合主界面上调用（可下单、研究）
 */
async function playToEnd(page, { check = false, tag = '', hooks = {} } = {}) {
  const shot = new Set();
  const snap = async (kind) => { if (check && !shot.has(kind)) { shot.add(kind); await H.shot(page, `${tag}-${kind}`); } };
  for (let guard = 0; guard < 400; guard++) {
    if (await H.visible(page, '#settlement')) return;
    if (await H.visible(page, '#rules')) {
      if (check) { await checkCard(page, '#rules', ['[data-action=rules-close]'], `${tag} 规则页`); await snap('rules'); }
      await page.click('[data-action=rules-close]'); continue;
    }
    if (await H.visible(page, '#weekly')) {
      if (check) { await checkCard(page, '#weekly', ['#btnWeeklyClose'], `${tag} 回合小结`); await snap('weekly'); }
      await page.click('#btnWeeklyClose'); continue;
    }
    if (await H.visible(page, '#quarter')) {
      if (check) { await checkCard(page, '#quarter', ['#btnQuarterClose'], `${tag} 季度成绩单`); await snap('quarter'); }
      await page.click('#btnQuarterClose'); continue;
    }
    const turn = await page.evaluate(() => App.getState().turn);
    if (hooks.onTurn) await hooks.onTurn(turn);
    if (check && turn === 3) {
      await page.click('#btnHistory');
      await checkCard(page, '#history', ['[data-action=hist-close]'], `${tag} 回合历史`); await snap('history');
      await page.click('[data-action=hist-close]');
    }
    await page.click('#btnEndTurn');
    await waitAny(page, ['#weekly', '#settlement']);
  }
  throw new Error('对局没有结束');
}

async function buy(page, idx, lots) {
  await page.click(`#companyList [data-action=select] >> nth=${idx}`);
  await page.fill('#lotsInput', String(lots));
  await page.click('[data-action=order][data-side=buy]');
}

/** 结算页：三个按钮可见可点；复盘页返回按钮可见可点；导出的记录能重放出相同的期末资产 */
async function checkSettlement(page, tag) {
  await checkCard(page, '#settlement', ['[data-action=export]', '[data-action=review-open]', '[data-action=restart-confirmed]'], `${tag} 结算页`);
  await H.shot(page, `${tag}-settlement`);
  await page.click('[data-action=review-open]');
  await expectClickable(page, '[data-action=review-close]', `${tag} 复盘页（顶部）`);
  await page.$eval('#review', (el) => { el.scrollTop = el.scrollHeight; });
  await expectClickable(page, '[data-action=review-close]', `${tag} 复盘页（滚到底）`);
  await H.shot(page, `${tag}-review`);
  await page.click('[data-action=review-close]');
  await expectClickable(page, '[data-action=export]', `${tag} 结算页（从复盘返回）`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export]')]);
  return JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
}

function assertReplayable(rec) {
  const s = Record.replay(rec);
  const end = s.equity[s.equity.length - 1].assets;
  assert.ok(Math.abs(end - rec.turns[rec.turns.length - 1].assetsAfter) < 0.01, '重放的期末资产与记录一致');
  assert.ok(Math.abs(end - rec.result.totalAssets) < 0.01);
  assert.equal(rec.turns.length, Config.totalTurns);
  assert.deepEqual(rec.turns.map((t) => t.turn), Array.from({ length: Config.totalTurns }, (_, i) => i + 1), '每个回合只结算一次');
}

for (const vp of SIZES) {
  test(`界面：${vp.width}×${vp.height} 打完一局，所有弹窗按钮可见可点`, { skip, timeout: 240000 }, async () => {
    const tag = `${vp.width}x${vp.height}`;
    const { ctx, page, errors } = await H.openPage(browser, vp);
    await playToEnd(page, { check: true, tag, hooks: { onTurn: async (t) => {
      if (t === 1) { await page.click('[data-action=research]'); await buy(page, 0, 3); await buy(page, 2, 2); }
      if (t === 7) await buy(page, 1, 1);
    } } });
    const rec = await checkSettlement(page, tag);
    assert.equal(rec.gameVersion, Config.gameVersion);
    assertReplayable(rec);
    await page.click('[data-action=restart-confirmed]');
    assert.equal(await page.evaluate(() => App.getState().turn), 1);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test('界面：仓库自带的 AI 试玩记录重放成当前版本存档后，三种尺寸下结算页按钮都可见可点', { skip, timeout: 120000 }, async () => {
  const src = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'docs', 'ai-试玩记录-v0.3', 'records', 'kline-game-ai-g2.json'), 'utf8'));
  let s = State.newGame(src.seed);
  const rec = Record.create(src.seed, src.startedAt, 0);
  for (const t of src.turns) {
    rec.pending.research = t.research;
    const next = State.advanceTurn(s, { research: t.research.map((r) => ({ id: r.id, points: r.points })), orders: t.orders });
    Record.commitTurn(rec, { turn: t.turn, orders: t.orders, durationMs: t.durationMs, newsShown: t.news, state: next, endedAt: src.endedAt });
    s = next;
  }
  assert.equal(s.status, 'ended');
  for (const vp of SIZES) {
    const { ctx, page, errors } = await H.openPage(browser, vp, injectSave({ state: s, record: rec, view: null }));
    assert.ok(await H.visible(page, '#settlement'));
    await checkSettlement(page, `ai-g2-${vp.width}x${vp.height}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

// ── 旧版本 / 缺字段存档 ──
function finishedSave(seed, mutate) {
  let s = State.newGame(seed);
  const rec = Record.create(seed, '2026-01-01T00:00:00.000Z', 0);
  while (s.status === 'playing') {
    const next = State.advanceTurn(s, {});
    Record.commitTurn(rec, { turn: s.turn, orders: [], durationMs: 1000, newsShown: [], state: next, endedAt: '2026-01-01T00:10:00.000Z' });
    s = next;
  }
  const d = JSON.parse(JSON.stringify({ state: s, record: rec, view: null }));
  mutate(d);
  return d;
}

const OLD = [
  ['v0.2 已结算存档（没有 result.score）', (d) => { d.record.gameVersion = 'v0.2-playtest'; delete d.state.result.score; delete d.state.result.excessDrawdown; delete d.record.result.score; }, /此存档来自旧版本 v0\.2-playtest，无法在当前版本继续/, 'v0.2-playtest'],
  ['v0.3 存档（没有超额回撤）', (d) => { d.record.gameVersion = 'v0.3-playtest'; delete d.state.result.excessDrawdown; d.record.result.score.total = 7.5; }, /此存档来自旧版本 v0\.3-playtest，无法在当前版本继续/, 'v0.3-playtest'],
  ['当前版本但缺少 result.score', (d) => { delete d.state.result.score; }, /缺少关键数据（state\.result\.score），无法在当前版本继续/, Config.gameVersion]
];
for (const [name, mutate, msg, ver] of OLD) {
  test(`旧存档：${name} → 提示无法继续，可导出原记录、可开始新局，不报错`, { skip, timeout: 60000 }, async () => {
    const save = finishedSave(31, mutate);
    const { ctx, page, errors } = await H.openPage(browser, SIZES[0], injectSave(save));
    assert.ok(await H.visible(page, '#oldSave'), '应显示旧存档提示');
    assert.match(await page.textContent('#oldSaveMsg'), msg);
    assert.equal(await H.visible(page, '#settlement'), false);
    await expectClickable(page, '[data-action=oldsave-export]', '导出原记录');
    await expectClickable(page, '[data-action=oldsave-new]', '开始新局');
    await H.shot(page, 'oldsave-' + ver);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=oldsave-export]')]);
    const out = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.deepEqual(out, save.record, '原样导出存档里的记录');
    assert.equal(out.gameVersion, ver, 'gameVersion 保留原版本');
    // 存档在点"开始新局"之前不被覆盖
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY), JSON.stringify(save));
    await page.click('[data-action=oldsave-new]');
    assert.equal(await H.visible(page, '#oldSave'), false);
    assert.equal(await page.evaluate(() => App.getState().turn), 1);
    assert.equal(await page.evaluate(() => App.getRecord().gameVersion), Config.gameVersion);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
