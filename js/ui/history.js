/* ui/history.js — 回合历史：切换查看之前任意回合
   显示：该回合开始时看到的新闻、你那一回合做的研究（估值与误差）、该回合的结果小结。
   不显示真实价值 V（游戏结束前不得泄露；研究日志里的 trueV 在这里从不读取）。 */
const GameHistory = (() => {
  const fmt = (n) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let cur = null;

  /** 可查看的最大回合：进行中 = 当前回合；已结束 = 最后打完的回合 */
  const maxTurn = (state) => (state.status === 'ended' ? state.result.turnsPlayed : state.turn);

  function render(state, turn) {
    cur = state;
    const max = maxTurn(state);
    turn = Math.max(1, Math.min(turn, max));
    const h = GameSummary.historyOf(state, turn);
    const inProgress = state.status === 'playing' && turn === state.turn;
    const chips = Array.from({ length: max }, (_, i) => i + 1).map((t) =>
      `<button class="chip ${t === turn ? 'active' : ''}" data-action="hist-go" data-turn="${t}">${t}</button>`).join('');
    const rs = h.research.length
      ? `<table class="wk-table"><tr><th>公司</th><th>投入</th><th>估值</th><th>误差范围</th></tr>${h.research.map((r) =>
          `<tr><td>${r.name}</td><td>${r.points} 点</td><td>¥${fmt(r.estimate)}</td><td class="muted">±${(r.sigma * 100).toFixed(0)}%</td></tr>`).join('')}</table>`
      : '<div class="muted">这一回合没有做研究。</div>';
    const el = document.getElementById('history');
    el.innerHTML = `<div class="card history-card">
      <h2>回合历史 <span class="muted" style="font-size:13px;font-weight:400">${inProgress ? `第 ${turn} 回合（进行中）` : `第 ${turn} 回合`}</span></h2>
      <div class="chips">${chips}</div>
      <div class="wk-sec"><h4>这一回合开始时的新闻（上周发生的事）</h4><ul class="wk-news">${h.news.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>
      <div class="wk-sec"><h4>你这一回合做的研究</h4>${rs}</div>
      ${inProgress ? '<div class="muted" style="margin:8px 0">这一回合还没结束，结果要等你点"结束回合"。</div>'
        : `<h3 class="hist-h">这一回合的结果</h3>${GameWeekly.weekHtml(state, turn)}`}
      <div class="actions"><button class="primary" data-action="hist-close">关闭</button></div>
    </div>`;
    el.hidden = false;
  }

  function open(state) { render(state, maxTurn(state)); }
  function go(turn) { if (cur) render(cur, turn); }
  function close() { document.getElementById('history').hidden = true; }

  return { open, go, close };
})();
