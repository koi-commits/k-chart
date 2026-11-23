/* ui/weekly.js — 回合小结（每次结束回合、回放完成后弹出）
   展示：本周总盈亏、按公司拆分的盈亏、本周费用、成交/未成交、本周发生的新闻。
   只用玩家本来就能看到的信息：不显示真实价值 V，也不说明涨跌是基本面还是情绪。
   weekHtml() 同时被"回合历史"复用。 */
const GameWeekly = (() => {
  const fmt = (n) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => (n >= 0 ? '+' : '−') + '¥' + fmt(Math.abs(n));
  const pct = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%';
  const cls = (x) => (x > 0.004 ? 'up' : x < -0.004 ? 'down' : '');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** 第 turn 回合（已结束）小结的 HTML 片段 */
  function weekHtml(state, turn) {
    const w = GameSummary.weekSummary(state, turn);
    const rows = w.rows.map((r) => `<tr><td>${r.name}</td>
      <td class="${cls(r.weekChange)}">${pct(r.weekChange)}</td>
      <td>${r.sharesEnd ? r.sharesEnd + ' 股' : '<span class="muted">—</span>'}</td>
      <td class="${cls(r.pnl)}">${r.pnl === 0 && !r.sharesEnd ? '<span class="muted">—</span>' : money(r.pnl)}</td></tr>`).join('');
    const tr = w.trades.length
      ? w.trades.map((t) => `<div>${t.side === 'buy' ? '买入' : '卖出'} ${t.name} ${t.shares} 股 @${fmt(t.price)}　<span class="muted">费用 ¥${fmt(t.fee)}</span></div>`).join('')
      : '<div class="muted">本周没有成交。</div>';
    const failed = w.failed.map((f) => `<div class="warn">未成交：${f.side === 'buy' ? '买入' : '卖出'} ${f.name} ${f.shares} 股 — ${esc(f.error)}</div>`).join('');
    const news = w.news.length ? w.news.map((h) => `<li>${esc(h)}</li>`).join('') : '<li class="muted">本周市场平静，没有重大消息。</li>';
    return `<div class="wk-big"><div><span>本周总盈亏</span><b class="${cls(w.total)}">${money(w.total)}</b></div>
        <div><span>本周费用</span><b>¥${fmt(w.fees)}</b></div>
        <div><span>周末总资产</span><b>¥${fmt(w.assetsEnd)}</b></div></div>
      <table class="wk-table"><tr><th>公司</th><th>本周股价</th><th>周末持仓</th><th>本周盈亏</th></tr>${rows}</table>
      <div class="wk-sec"><h4>成交</h4>${tr}${failed}</div>
      <div class="wk-sec"><h4>本周新闻</h4><ul class="wk-news">${news}</ul></div>`;
  }

  /** 结束回合后弹出的小结 */
  function open(state, turn) {
    const el = document.getElementById('weekly');
    const last = turn >= GameConfig.totalTurns || state.status === 'ended';
    el.innerHTML = `<div class="card weekly-card">
      <h2>第 ${turn} 回合小结</h2>
      <div class="sub">${last ? '这是最后一个回合，点"继续"查看结算。' : '下一回合开始前，先看看这一周发生了什么。'}</div>
      ${weekHtml(state, turn)}
      <div class="actions"><button class="primary" data-action="weekly-close" id="btnWeeklyClose">${last ? '查看结算 ▶' : '继续 ▶'}</button></div>
    </div>`;
    el.hidden = false;
    const b = document.getElementById('btnWeeklyClose'); if (b) b.focus();
  }

  function close() { document.getElementById('weekly').hidden = true; }

  return { open, close, weekHtml };
})();
