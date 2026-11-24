// 端到端测试的公共工具：用 Playwright 打开 index.html（file://），驱动真实界面
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = path.join(ROOT, 'test-results', 'e2e');

let playwright = null;
try { playwright = require('playwright'); } catch (e) { /* 没装 Playwright 时测试会跳过 */ }

async function launch() { return playwright.chromium.launch(); }

/** 新开一个页面（独立 localStorage）。init(page) 可在页面加载前注入脚本 */
async function openPage(browser, viewport, beforeLoad) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (beforeLoad) await beforeLoad(page);
  await page.goto(URL);
  await page.waitForFunction(() => typeof App !== 'undefined' && document.getElementById('verTag').textContent !== '');
  return { ctx, page, errors };
}

/**
 * 元素是否"看得见且点得到"：完整落在视口内，并且元素中心点上最上层的就是它（没被别的东西挡住）
 */
async function clickable(page, selector) {
  const h = await page.$(selector);
  if (!h) return { ok: false, why: selector + ' 不存在' };
  const r = await h.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const inView = b.width > 0 && b.height > 0 && b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight && b.right <= innerWidth;
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { inView, hit: !!top && (top === el || el.contains(top)), rect: [b.left, b.top, b.right, b.bottom].map(Math.round), vh: innerHeight, vw: innerWidth };
  });
  return Object.assign(r, { ok: r.inView && r.hit, why: `${selector} ${JSON.stringify(r)}` });
}

/** 把弹窗卡片滚到最底 / 最顶 */
async function scrollCard(page, overlaySel, where) {
  await page.$eval(overlaySel + ' .card', (c, w) => { c.scrollTop = w === 'bottom' ? c.scrollHeight : 0; }, where);
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: file });
  return file;
}

const visible = (page, sel) => page.$eval(sel, (el) => !el.hidden).catch(() => false);

module.exports = { playwright, launch, openPage, clickable, scrollCard, shot, visible, ROOT, URL, SHOTS };
