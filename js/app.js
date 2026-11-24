/* app.js — 界面控制器：把用户操作转成对纯逻辑的调用，并负责存档与流程 */
const App = (() => {
  let state = null;
  let record = null;      // 试玩记录（见 game/record.js），随存档保存
  let segStart = Date.now(); // 回合计时：当前这段计时的起点（毫秒）
  let clockRunning = false;  // 回合计时是否在走：只在回合界面、没有弹窗、不在回放时走
  let view = null;          // 还没看完的结算弹窗：{weeklyTurn} 回合小结 / {quarter} 季度成绩单；随存档保存
  let badSave = null;       // 无法加载的旧存档（见 GameSave.check）
  // ui.pending 与 record.pending.orders 是同一个数组：订单队列每次变化都随存档写入
  const ui = { selected: null, pending: [], lots: 1, researchN: 1, busy: false };

  function render(upto) {
    GameView.renderAll(state, ui, upto);
    GameReplay.showChart(state, ui.selected, upto);
  }

  /**
   * 回合计时。在任何可能改变"是否该计时"的时刻调用（弹窗开关、回放开始/结束、存档、读档）：
   * 先把正在走的这段时间记进本回合耗时，再按当前情况决定继续走还是暂停。
   * 只有玩家在回合界面且没有任何弹窗、也不在回放时才计时；所以存档里的耗时不含读小结、看规则、看历史的时间。
   */
  function clockSync() {
    const now = Date.now();
    if (clockRunning && record) record.pending.accMs += now - segStart;
    segStart = now;
    clockRunning = !!(state && record && state.status === 'playing' && !ui.busy && !GameModal.isOpen());
  }

  /** 存档（先结算计时：回放途中、弹窗打开时的时间不计入回合耗时） */
  function persist() {
    if (!state || !record) return;
    clockSync();
    GameSave.save(state, record, view);
  }

  /** 把 ui.pending 挂到 record.pending.orders 上（同一个数组），之后增删订单直接存档 */
  function bindPending() {
    if (!Array.isArray(record.pending.orders)) record.pending.orders = [];
    ui.pending = record.pending.orders;
  }

  /** 打开/关闭规则页；阅读规则的时间不计入回合耗时 */
  function openRules(first) { clockSync(); GameRules.open(first); clockSync(); }
  function closeRules() { GameRules.close(); clockSync(); }

  /** 退出游戏：先存档，再关闭（Electron 里走 IPC，浏览器里 window.close） */
  function quitGame() {
    persist();
    if (window.gameAPI && window.gameAPI.quit) window.gameAPI.quit();
    else window.close();
  }

  /** @param restarts 沿用/累计的"重新开始"次数 */
  function newGame(restarts) {
    state = GameState.newGame(crypto.getRandomValues(new Uint32Array(1))[0]); // 种子在 UI 层生成
    record = GameRecord.create(state.seed, new Date().toISOString(), restarts || 0);
    clockRunning = false; view = null; badSave = null;
    bindPending(); ui.lots = 1; ui.researchN = 1;
    ui.selected = Object.keys(state.companies)[0];
    GameSave.save(state, record, view);
    hideOldSave();
    GameView.hideSettlement();
    GameReview.close();
    render();
    clockSync();
  }

  /** 操作失败/无效操作的提示：显示在对应面板的操作按钮旁边，醒目，几秒后自动消失 */
  function toast(msg, where) { GameView.showToast(where || 'order', msg); }

  // ── 操作 ──
  function select(id) { ui.selected = id; ui.researchN = 1; render(); }

  function adjustResearchN(d) {
    ui.researchN = Math.max(1, Math.min(state.pointsLeft, ui.researchN + d));
    render();
  }

  function doResearch() {
    const res = GameResearch.research(state, ui.selected, Math.min(ui.researchN, state.pointsLeft));
    if (res.error) return toast(res.error, 'research');
    state = res.state;
    ui.researchN = 1;
    const e = state.research[ui.selected];
    record.pending.research.push({ id: ui.selected, points: e.points, estimate: e.estimate, sigma: e.sigma });
    persist(); // 研究结果不可反悔，立即存档防止读档重抽
    render();
  }

  function readLots() {
    const v = parseInt(document.getElementById('lotsInput').value, 10);
    ui.lots = v >= 1 ? v : 1;
    return ui.lots;
  }

  function addOrder(side) {
    const lots = readLots();
    const L = GameView.limits(state, ui, ui.selected);
    const max = side === 'buy' ? L.buyLots : L.sellLots;
    if (lots > max) { toast(side === 'buy' ? `资金不足，最多还能买 ${max} 手` : `可卖不足，最多还能卖 ${max} 手`); return; }
    ui.pending.push({ id: ui.selected, side, lots });
    persist();   // 订单队列变化即存档：刷新后订单不丢
    render();
  }

  function fill(k) {
    const L = GameView.limits(state, ui, ui.selected);
    const n = k === 'sell' ? L.sellLots : Math.floor(L.buyLots * parseFloat(k));
    ui.lots = Math.max(1, n);
    render();
  }

  function cancel(i) { ui.pending.splice(i, 1); persist(); render(); }

  /**
   * 结束回合：先结算（advanceTurn）并把新状态 + 试玩记录一次性存档，再开始回放。
   * 回放只是展示；回放途中退出，重进时直接显示回合小结（view.weeklyTurn），不会重播、也不会重复结算。
   */
  function endTurn() {
    if (!state || ui.busy || state.status !== 'playing') return;
    readLots();
    const orders = ui.pending.map((o) => ({ id: o.id, side: o.side, shares: o.lots * GameConfig.lotSize }));
    clockSync();                                   // 把本回合最后这段时间记进去
    const durationMs = record.pending.accMs;
    const turn = state.turn, newsShown = state.news.map((n) => n.headline);
    const next = GameState.advanceTurn(state, { orders });
    GameRecord.commitTurn(record, { turn, orders, durationMs, newsShown, state: next, endedAt: new Date().toISOString() });
    state = next; bindPending(); ui.researchN = 1;
    view = { weeklyTurn: turn };
    GameSave.save(state, record, view);          // 结算结果先落盘
    ui.busy = true; clockSync();                   // 回放期间不计时
    document.getElementById('btnEndTurn').disabled = true;
    GameReplay.play(next, ui, (upto) => {
      GameView.renderTopbar(next, upto);
      GameView.renderCompanies(next, ui, upto);
      GameView.chartTitle(next, ui, upto);
    }, () => {
      ui.busy = false;
      render();
      showView();
      clockSync();                                 // 小结打开：继续暂停
    });
  }

  /** 显示还没看完的结算弹窗（回合小结 / 季度成绩单），或已结束对局的结算页 */
  function showView() {
    if (view && view.weeklyTurn) { ui.weeklyTurn = view.weeklyTurn; GameWeekly.open(state, view.weeklyTurn); return; }
    if (view && view.quarter) { GameView.renderQuarterReport(state, view.quarter); return; }
    if (state.status === 'ended') GameView.renderSettlement(state);
  }

  function openHistory() { if (ui.busy || !state) return; clockSync(); GameHistory.open(state); clockSync(); }
  function closeHistory() { GameHistory.close(); clockSync(); }   // 查看历史的时间不计入回合耗时

  function closeWeekly() {
    GameWeekly.close();
    const L = GameConfig.quarterLength, t = ui.weeklyTurn;
    view = t % L === 0 && GameState.quarterResults(state).length >= t / L ? { quarter: t / L } : null;
    GameSave.save(state, record, view);
    showView();
    clockSync();                      // 阅读小结的时间不计入下一回合耗时：从这里（没有弹窗时）才开始计
  }

  function closeQuarter() {
    GameView.hideQuarterReport();
    view = null;
    GameSave.save(state, record, view);
    showView();
    clockSync();
  }

  /** 导出本局记录为 JSON 文件（种子、每回合行动与耗时、最终结果） */
  async function exportRecord() {
    // gameVersion 保留记录创建时的版本（不替换成当前版本）
    const out = Object.assign({}, record, { exportedAt: new Date().toISOString(), app: 'kline-game-v0' });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    await downloadText(`kline-game-seed${record.seed}-${stamp}.json`, JSON.stringify(out, null, 2), 'exportMsg');
  }

  /** 保存文本文件：Electron 走系统保存对话框，浏览器直接下载；结果写到 msgId 元素里 */
  async function downloadText(filename, text, msgId) {
    const msg = (t) => { const el = document.getElementById(msgId); if (el) el.textContent = t; };
    if (window.gameAPI && window.gameAPI.saveRecord) {          // Electron：系统保存对话框
      const r = await window.gameAPI.saveRecord(filename, text);
      msg(r.ok ? '✔ 已保存到：' + r.path : r.canceled ? '已取消导出' : '✘ 保存失败：' + r.error);
      return;
    }
    const a = document.createElement('a');                        // 浏览器：直接下载
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    msg('已开始下载 ' + filename);
  }

  // ── 无法加载的旧存档 ──
  function showOldSave(bad) {
    badSave = bad;
    const el = document.getElementById('oldSave');
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    el.innerHTML = `<div class="card oldsave-card">
      <h2>无法继续上次的对局</h2>
      <div class="sub" id="oldSaveMsg">${esc(GameSave.message(bad))}</div>
      <div class="muted" style="font-size:13px;line-height:1.7">当前版本是 ${esc(GameConfig.gameVersion)}。不同版本的规则和计分不同，旧存档不做转换。你可以先把原来的试玩记录导出保存（原样导出，不改版本号、不按新规则重新计分），再开始新的一局。</div>
      <div class="export-msg muted" id="oldSaveExportMsg"></div>
      <div class="actions"><button data-action="oldsave-export">💾 导出原记录</button> <button class="primary" data-action="oldsave-new">开始新局</button></div>
    </div>`;
    el.hidden = false;
  }
  function hideOldSave() { const el = document.getElementById('oldSave'); if (el) el.hidden = true; }

  async function exportOldSave() {
    if (!badSave) return;
    const o = GameSave.originalExport(badSave);
    const tag = String(o.version || 'unknown').replace(/[^\w.-]/g, '_');
    await downloadText(`kline-game-${o.seed != null ? 'seed' + o.seed + '-' : ''}${tag}-original.json`, o.text, 'oldSaveExportMsg');
  }

  function startAfterOldSave() {
    newGame(0);
    if (!GameRules.seen()) openRules(true);
  }

  function restart() {
    if (ui.busy || !state) return;
    if (state.status === 'playing' && !window.confirm('放弃当前对局并重新开始？')) return;
    newGame(record.restartCount + 1);   // 记录"重新开始"次数（取消确认不计）
  }

  // ── 事件委托 ──
  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || ui.busy) return;
    if (!state && !/^oldsave-/.test(el.dataset.action)) return;   // 旧存档提示页上只响应它自己的两个按钮
    const d = el.dataset;
    switch (d.action) {
      case 'select': select(d.id); break;
      case 'rn': adjustResearchN(parseInt(d.d, 10)); break;
      case 'research': doResearch(); break;
      case 'order': addOrder(d.side); break;
      case 'fill': fill(d.k); break;
      case 'cancel': cancel(parseInt(d.i, 10)); break;
      case 'restart-confirmed': newGame(record.restartCount); break;   // 再来一局：沿用次数，不加
      case 'export': exportRecord(); break;
      case 'oldsave-export': exportOldSave(); break;
      case 'oldsave-new': startAfterOldSave(); break;
      case 'rules-close': closeRules(); break;
      case 'weekly-close': closeWeekly(); break;
      case 'quarter-close': closeQuarter(); break;
      case 'stale-news': GameHistory.openNews(state, d.id); break;
      case 'newspop-close': GameHistory.closeNews(); break;
      case 'hist-go': GameHistory.go(parseInt(d.turn, 10)); break;
      case 'hist-close': closeHistory(); break;
      case 'review-open': GameReview.render(state); break;
      case 'review-close': GameReview.close(); break;
    }
  }

  function init() {
    if (typeof LightweightCharts === 'undefined') { setTimeout(init, 100); return; }
    document.getElementById('verTag').textContent = GameConfig.gameVersion;
    ChartManager.init();
    GameModal.init();               // 弹窗打开时背景 inert、焦点锁在弹窗内
    GameModal.onChange(() => clockSync());   // 任何弹窗开关都同步一次回合计时（新闻弹窗、结算页等也算）
    document.addEventListener('click', onClick);
    document.getElementById('btnEndTurn').addEventListener('click', endTurn);
    document.getElementById('btnRestart').addEventListener('click', restart);
    document.getElementById('btnHistory').addEventListener('click', openHistory);
    document.getElementById('btnRules').addEventListener('click', () => openRules(false));
    document.getElementById('btnQuit').addEventListener('click', quitGame);
    window.addEventListener('pagehide', persist);  // 点窗口右上角关闭时也存一次（保存回合耗时）
    window.addEventListener('resize', () => ChartManager.resize());

    const saved = GameSave.load();     // 有存档就自动继续（没有手动读档）
    if (saved && !saved.ok) { showOldSave(saved); return; }   // 旧版本/缺字段：不进入游戏，不报错
    if (saved) {
      try {
        state = saved.state; record = saved.record; view = saved.view; clockRunning = false;
        bindPending();
        ui.selected = Object.keys(state.companies)[0];
        render();
        showView();                    // 回放途中退出：直接显示回合小结，不重播、不重复结算
        clockSync();                   // 读档恢复：有弹窗就继续暂停
      } catch (e) {
        console.warn('存档无法显示', e);
        state = null; record = null; view = null;
        showOldSave({ ok: false, reason: 'broken', field: String(e && e.message || e), version: saved.record && saved.record.gameVersion, record: saved.record, raw: null });
        return;
      }
    } else newGame(0);
    if (!GameRules.seen()) openRules(true);   // 第一次开局：弹出规则说明
  }

  window.addEventListener('DOMContentLoaded', init);
  return { newGame, endTurn, getState: () => state, getRecord: () => record };
})();
