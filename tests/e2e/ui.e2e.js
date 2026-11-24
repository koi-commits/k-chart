// 端到端测试（Playwright，真实界面）：npm run test:e2e
// 1) 三种窗口尺寸下各打完一局：所有弹窗的按钮都看得见、点得到（截图在 test-results/e2e/）
// 2) 仓库自带的 AI 试玩记录按当前规则重放成存档后，结算页按钮可见可点
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
