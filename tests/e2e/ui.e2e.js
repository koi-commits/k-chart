// 端到端测试（Playwright，真实界面）：npm run test:e2e
// 1) 三种窗口尺寸下各打完一局：所有弹窗的按钮都看得见、点得到（截图在 test-results/e2e/）
// 2) 仓库自带的 AI 试玩记录按当前规则重放成存档后，结算页按钮可见可点
// 3) 旧版本 / 缺字段存档：不进入游戏、不报错，可原样导出原记录、可开始新局
// 4) 自动存档：下单后刷新订单不丢；回放途中退出重进直接显示回合小结、不重复结算；导出记录可重放出相同期末资产
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

// ── 自动存档 ──
test('自动存档：下单后刷新，待执行订单与研究都还在，结束回合按这些订单成交', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await H.openPage(browser, SIZES[0]);
  await page.click('[data-action=rules-close]');
  await page.click('[data-action=research]');
  await buy(page, 1, 2); await buy(page, 3, 1);
  await page.click('[data-action=cancel] >> nth=1');          // 撤销也要存档
  await buy(page, 0, 4);
  const before = await page.evaluate(() => ({ p: App.getRecord().pending, s: App.getState().seed }));
  assert.equal(before.p.orders.length, 2);
  await page.reload();
  await page.waitForFunction(() => typeof App !== 'undefined' && App.getState());
  const after = await page.evaluate(() => ({ p: App.getRecord().pending, s: App.getState().seed, html: document.getElementById('pendingPanel').textContent }));
  assert.equal(after.s, before.s);
  assert.deepEqual(after.p.orders, before.p.orders, '刷新后订单队列不丢');
  assert.deepEqual(after.p.research, before.p.research, '刷新后研究还在');
  assert.match(after.html, /2 手/); assert.match(after.html, /4 手/);
  await page.click('#btnEndTurn');
  await waitAny(page, ['#weekly']);
  const t1 = await page.evaluate(() => App.getRecord().turns[0]);
  assert.deepEqual(t1.orders, before.p.orders.map((o) => ({ id: o.id, side: o.side, shares: o.lots * Config.lotSize })).map((o) => o),
    '成交的是刷新前下的订单');
  assert.equal(await page.evaluate(() => App.getRecord().pending.orders.length), 0, '结算后订单队列清空');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('自动存档：回放途中退出后重进，直接显示回合小结，不重播、不重复结算；导出记录可重放出相同期末资产', { skip, timeout: 180000 }, async () => {
  const { ctx, page, errors } = await H.openPage(browser, SIZES[0]);
  await page.click('[data-action=rules-close]');
  await buy(page, 2, 3);
  await page.click('#btnEndTurn');
  await page.waitForTimeout(400);                               // 回放约 2 秒，这里在回放途中刷新
  assert.equal(await H.visible(page, '#weekly'), false, '此时仍在回放');
  await page.reload();
  await page.waitForFunction(() => typeof App !== 'undefined' && App.getState());
  assert.ok(await H.visible(page, '#weekly'), '重进后直接显示回合小结');
  assert.match(await page.textContent('#weekly h2'), /第 1 回合小结/);
  let st = await page.evaluate(() => ({ turn: App.getState().turn, n: App.getRecord().turns.length, eq: App.getState().equity.length, orders: App.getRecord().turns[0].orders }));
  assert.equal(st.turn, 2); assert.equal(st.n, 1); assert.equal(st.eq, Config.daysPerTurn + 1);
  assert.equal(st.orders.length, 1, '已提交的订单已成交');
  await page.click('#btnWeeklyClose');
  await page.reload();                                          // 看完小结后再刷新：不再弹小结，也不会再结算一次
  await page.waitForFunction(() => typeof App !== 'undefined' && App.getState());
  assert.equal(await H.visible(page, '#weekly'), false);
  st = await page.evaluate(() => ({ turn: App.getState().turn, n: App.getRecord().turns.length, eq: App.getState().equity.length }));
  assert.equal(st.turn, 2); assert.equal(st.n, 1); assert.equal(st.eq, Config.daysPerTurn + 1);
  // 第 5 回合（季度末）回放途中退出：重进先看小结，再看季度成绩单
  await playToEnd(page, { hooks: { onTurn: async (t) => {
    if (t === 5) {
      await page.click('#btnEndTurn'); await page.waitForTimeout(400); await page.reload();
      await page.waitForFunction(() => typeof App !== 'undefined' && App.getState());
      assert.ok(await H.visible(page, '#weekly'));
      await page.click('#btnWeeklyClose');
      assert.ok(await H.visible(page, '#quarter'), '季度末：小结之后是季度成绩单');
      await page.reload();                                      // 成绩单没看完就退出：重进还显示成绩单
      await page.waitForFunction(() => typeof App !== 'undefined' && App.getState());
      assert.ok(await H.visible(page, '#quarter'));
      await page.click('#btnQuarterClose');
    }
  } } });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action=export]')]);
  const rec = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  assertReplayable(rec);
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ── 键盘：弹窗打开时背景不可交互 ──
/** 在弹窗 sel 打开时尝试各种按键：焦点始终留在弹窗内，背景的"结束回合"等按钮无法被触发 */
async function keyboardStaysInside(page, sel, label) {
  const snapshot = () => page.evaluate(() => ({ turn: App.getState().turn, n: App.getRecord().turns.length, pend: App.getRecord().pending.orders.length }));
  const before = await snapshot();
  const inside = () => page.evaluate((s) => document.querySelector(s).contains(document.activeElement), sel);
  for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    assert.ok(await inside(), `${label}：按 ${key} 后焦点跑出了弹窗`);
  }
  // 背景元素拿不到焦点（inert）；就算强行 focus，Enter / Space 也不会作用到背景
  for (const bg of ['#btnEndTurn', '#btnRestart', '#lotsInput', '[data-action=order][data-side=buy]']) {
    await page.$eval(bg, (el) => el.focus());
    assert.ok(await inside(), `${label}：背景元素 ${bg} 不应能获得焦点`);
    // 焦点落到弹窗外（页面 body）时按 Enter / Space：必须被拦下，不能作用到背景
    for (const key of ['Enter', ' ']) {
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.keyboard.press(key);
      assert.ok(await H.visible(page, sel), `${label}：焦点在弹窗外时按 ${key === ' ' ? 'Space' : key} 把弹窗关掉了`);
    }
  }
  const b = await page.$eval('#btnEndTurn', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(b.x, b.y);                             // 真实鼠标点在背景按钮的位置上：点到的是遮罩，不触发
  assert.deepEqual(await snapshot(), before, `${label}：背景操作被触发了`);
  assert.ok(await H.visible(page, sel), `${label}：弹窗被关掉了`);
  assert.equal(await page.$eval('#app', (el) => el.inert), true);
}

test('键盘：规则页、回合小结、季度成绩单打开时，Tab/Shift+Tab/Enter/Space 都碰不到背景，季度成绩单不会被跳过', { skip, timeout: 120000 }, async () => {
  const { ctx, page, errors } = await H.openPage(browser, SIZES[0]);
  assert.ok(await H.visible(page, '#rules'));                  // 首次启动自动弹出规则页
  await keyboardStaysInside(page, '#rules', '规则页');
  await page.focus('#rules .actions .primary');
  await page.keyboard.press('Enter');                           // Enter 作用在规则页自己的按钮上：关闭规则页
  assert.equal(await H.visible(page, '#rules'), false);
  await page.waitForFunction(() => !document.getElementById('app').inert, null, { timeout: 2000 });   // 弹窗全部关闭后背景恢复可交互
  assert.equal(await page.evaluate(() => App.getState().turn), 1, '关闭规则页不应结束回合');
  for (let t = 1; t <= 5; t++) {
    await page.click('#btnEndTurn');
    await waitAny(page, ['#weekly']);
    if (t < 5) await page.click('#btnWeeklyClose');
  }
  await keyboardStaysInside(page, '#weekly', '第 5 回合小结');
  await page.focus('#btnWeeklyClose');
  await page.keyboard.press('Enter');                           // 关闭小结 → 必须出现第 1 季度成绩单
  assert.ok(await H.visible(page, '#quarter'), '季度成绩单被跳过了');
  assert.equal(await page.evaluate(() => App.getState().turn), 6);
  await keyboardStaysInside(page, '#quarter', '第 1 季度成绩单');
  await page.focus('#btnQuarterClose');
  await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');   // 按住 Enter 的自动重复不能连跳
  assert.equal(await H.visible(page, '#quarter'), false);
  assert.equal(await page.evaluate(() => ({ t: App.getState().turn, n: App.getRecord().turns.length })).then((x) => x.t === 6 && x.n === 5), true, '关闭成绩单不应结束回合');
  // 回合历史、规则页（手动打开）也一样
  await page.click('#btnHistory');
  await keyboardStaysInside(page, '#history', '回合历史');
  await page.click('[data-action=hist-close]');
  await page.click('#btnRules');
  await keyboardStaysInside(page, '#rules', '规则页（手动打开）');
  await page.click('[data-action=rules-close]');
  assert.deepEqual(errors, []);
  await ctx.close();
});

// ── 回合计时：弹窗打开期间暂停 ──
test('回合计时：小结打开期间等待后刷新，下一回合耗时从 0 开始；弹窗期间暂停，关掉后才计时', { skip, timeout: 60000 }, async () => {
  const { ctx, page, errors } = await H.openPage(browser, SIZES[0]);
  const acc = () => page.evaluate(() => App.getRecord().pending.accMs);
  const reload = async () => { await page.reload(); await page.waitForFunction(() => typeof App !== 'undefined' && App.getState()); };
  await page.waitForTimeout(800);                               // 规则页打开期间：不计时
  await page.click('[data-action=rules-close]');
  assert.ok(await acc() < 100, '看规则的时间不应计入');
  await page.waitForTimeout(700);                               // 回合界面上停留：计时
  await page.click('#btnEndTurn');
  await waitAny(page, ['#weekly']);
  const t1 = await page.evaluate(() => App.getRecord().turns[0].durationMs);
  assert.ok(t1 >= 600 && t1 < 1500, `第 1 回合耗时应约 0.7 秒（实际 ${t1}ms）`);
  await page.waitForTimeout(1500);                              // 停在小结 1.5 秒
  await reload();                                               // 刷新：退出时存档，读档恢复后小结仍开着
  assert.ok(await H.visible(page, '#weekly'));
  await page.waitForTimeout(600);                               // 读档后小结继续开着：仍然暂停
  const a0 = await acc();
  assert.ok(a0 < 100, `下一回合耗时应从 0 开始（实际 ${a0}ms）`);
  await page.click('#btnWeeklyClose');
  assert.ok(await acc() < 100);
  await page.waitForTimeout(600);                               // 关掉小结后在回合界面停留：开始计时
  await page.click('#btnHistory');                              // 打开回合历史：暂停
  await page.waitForTimeout(800);
  await reload();                                               // 历史弹窗打开时刷新
  const a1 = await acc();
  assert.ok(a1 >= 500 && a1 < 1000, `只应计入关掉小结后、打开历史前的约 0.6 秒（实际 ${a1}ms）`);
  assert.deepEqual(errors, []);
  await ctx.close();
});
