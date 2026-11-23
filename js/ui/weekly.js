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
      ? w.trades.map((t) => `<div>${t.side === 'buy' ? '买入' : '卖出'} ${t.name} ${t.shares} 股 @${fmt(t.price)}　<span class="muted">费用 ¥${fmt(t.fee)}</span>${t.requested ? `　<span class="warn">部分成交（申请 ${t.requested} 股）</span>` : ''}</div>`).join('')
      : '<div class="muted">本周没有成交。</div>';
    const failed = w.failed.map((f) => `<div class="warn">${f.error === '资金不足未成交' ? `资金不足未成交：${f.partial ? '剩余 ' : ''}买入 ${f.name} ${f.shares} 股（卖出所得与现金不足以支付全部买单）` : `未成交：${f.side === 'buy' ? '买入' : '卖出'} ${f.name} ${f.shares} 股 — ${esc(f.error)}`}</div>`).join('');
    const news = w.news.length ? w.news.map((h) => `<li>${esc(h)}</li>`).join('') : '<li class="muted">本周市场平静，没有重大消息。</li>';
    return `<div class="wk-big"><div><span>本周总盈亏</span><b class="${cls(w.total)}">${money(w.total)}</b></div>
        <div><span>本周费用</span><b>¥${fmt(w.fees)}</b></div>
        <div><span>周末总资产</span><b>¥${fmt(w.assetsEnd)}</b></div></div>
      <div class="muted" style="margin:-4px 0 12px;font-size:12px">本周内总资产相对历史最高点最深回落到 <b>${(w.weekDrawdown * 100).toFixed(1)}%</b>；截至周末的最大回撤 <b>${(w.maxDrawdownSoFar * 100).toFixed(1)}%</b>（上限 ${(GameConfig.winMaxDrawdown * 100).toFixed(0)}%）${GameTips.tip('最大回撤 = 从总资产历史最高点回落的最大幅度，按每日总资产计算，只增不减。哪怕本周收盘时赚钱了，周中某一天跌得更深也会计入。', 'r')}</div>
      <table class="wk-table"><tr><th>公司</th><th>本周累计涨跌${GameTips.tip('本周五收盘价相对上周五收盘价的涨跌，即一整周的累计涨跌。左侧公司列表里的"最近一日"只是最后一天的变化。')}</th><th>周末持仓</th><th>本周盈亏${GameTips.tip('本周总资产的变化里，这家公司贡献的部分（含买卖、持仓价格变化和手续费）。')}</th></tr>${rows}</table>
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
