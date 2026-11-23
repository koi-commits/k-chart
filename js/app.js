/* app.js — 界面控制器：把用户操作转成对纯逻辑的调用，并负责存档与流程 */
const App = (() => {
  let state = null;
  let record = null;      // 试玩记录（见 game/record.js），随存档保存
  let segStart = Date.now(); // 本回合当前停留片段的起点（毫秒）
  const ui = { selected: null, pending: [], lots: 1, researchN: 1, busy: false };

  function render(upto) {
    GameView.renderAll(state, ui, upto);
    GameReplay.showChart(state, ui.selected, upto);
  }

  /** 把当前停留片段计入本回合耗时（存档前、结束回合前调用） */
  function touchTime() {
    const now = Date.now();
    record.pending.accMs += now - segStart;
    segStart = now;
  }

  function persist() { touchTime(); GameSave.save(state, record); }

  function newGame() {
    state = GameState.newGame(crypto.getRandomValues(new Uint32Array(1))[0]); // 种子在 UI 层生成
    record = GameRecord.create(state.seed, new Date().toISOString());
    segStart = Date.now();
    ui.pending = []; ui.lots = 1; ui.researchN = 1;
    ui.selected = Object.keys(state.companies)[0];
    GameSave.save(state, record);
    GameView.hideSettlement();
    GameReview.close();
    render();
  }

  function toast(msg) {
    const log = document.getElementById('logPanel');
    log.insertAdjacentHTML('afterbegin', `<div class="err">${msg}</div>`);
  }

  // ── 操作 ──
  function select(id) { ui.selected = id; ui.researchN = 1; render(); }

  function adjustResearchN(d) {
    ui.researchN = Math.max(1, Math.min(state.pointsLeft, ui.researchN + d));
    render();
  }

  function doResearch() {
    const res = GameResearch.research(state, ui.selected, Math.min(ui.researchN, state.pointsLeft));
    if (res.error) return toast(res.error);
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
    render();
  }

  function fill(k) {
    const L = GameView.limits(state, ui, ui.selected);
    const n = k === 'sell' ? L.sellLots : Math.floor(L.buyLots * parseFloat(k));
    ui.lots = Math.max(1, n);
    render();
  }

  function cancel(i) { ui.pending.splice(i, 1); render(); }

  function endTurn() {
    if (ui.busy || state.status !== 'playing') return;
    readLots();
    ui.busy = true;
    const orders = ui.pending.map((o) => ({ id: o.id, side: o.side, shares: o.lots * GameConfig.lotSize }));
    touchTime();
    const durationMs = record.pending.accMs;
    const turn = state.turn, newsShown = state.news.map((n) => n.headline);
    const next = GameState.advanceTurn(state, { orders });
    ui.pending = [];
    document.getElementById('btnEndTurn').disabled = true;
    GameReplay.play(next, ui, (upto) => {
      GameView.renderTopbar(next, upto);
      GameView.renderCompanies(next, ui, upto);
      GameView.chartTitle(next, ui, upto);
    }, () => {
      GameRecord.commitTurn(record, { turn, orders, durationMs, newsShown, state: next, endedAt: new Date().toISOString() });
      state = next; ui.busy = false; ui.researchN = 1;
      segStart = Date.now();
      GameSave.save(state, record);
      render();
      if (state.status === 'ended') GameView.renderSettlement(state);
    });
  }

  /** 导出本局记录为 JSON 文件（种子、每回合行动与耗时、最终结果） */
  function exportRecord() {
    const out = Object.assign({}, record, { exportedAt: new Date().toISOString(), app: 'kline-game-v0' });
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kline-game-seed${record.seed}-${stamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function restart() {
    if (ui.busy) return;
    if (state.status === 'playing' && !window.confirm('放弃当前对局并重新开始？')) return;
    newGame();
  }

  // ── 事件委托 ──
  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || ui.busy) return;
    const d = el.dataset;
    switch (d.action) {
      case 'select': select(d.id); break;
      case 'rn': adjustResearchN(parseInt(d.d, 10)); break;
      case 'research': doResearch(); break;
      case 'order': addOrder(d.side); break;
      case 'fill': fill(d.k); break;
      case 'cancel': cancel(parseInt(d.i, 10)); break;
      case 'restart-confirmed': newGame(); break;
      case 'export': exportRecord(); break;
      case 'review-open': GameReview.render(state); break;
      case 'review-close': GameReview.close(); break;
    }
  }

  function init() {
    if (typeof LightweightCharts === 'undefined') { setTimeout(init, 100); return; }
    ChartManager.init();
    document.addEventListener('click', onClick);
    document.getElementById('btnEndTurn').addEventListener('click', endTurn);
    document.getElementById('btnRestart').addEventListener('click', restart);
    window.addEventListener('resize', () => ChartManager.resize());

    const saved = GameSave.load();     // 有存档就自动继续（没有手动读档）
    if (saved) {
      state = saved.state; record = saved.record; segStart = Date.now();
      ui.selected = Object.keys(state.companies)[0];
      render();
      if (state.status === 'ended') GameView.renderSettlement(state);
    } else newGame();
  }

  window.addEventListener('DOMContentLoaded', init);
  return { newGame, endTurn };
})();
