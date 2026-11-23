/* ui/view.js — 纯渲染：把 state + ui 状态画到 DOM（不改 state） */
const GameView = (() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => '¥' + fmt(n);
  const pct = (x, d = 2) => (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%';
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** 取前 upto 根（默认全部）K线的现价/昨收 */
  function quote(state, id, upto) {
    const c = state.candles[id];
    const n = upto == null ? c.length : upto;
    return { price: c[n - 1].close, prev: n >= 2 ? c[n - 2].close : c[n - 1].open };
  }

  function assetsAt(state, upto) {
    let v = state.cash;
    for (const id of Object.keys(state.positions)) v += state.positions[id].shares * quote(state, id, upto).price;
    return v;
  }

  function renderTopbar(state, upto) {
    $('turnLabel').textContent = `第 ${Math.min(state.turn, GameConfig.totalTurns)}/${GameConfig.totalTurns} 回合`;
    const a = assetsAt(state, upto);
    $('statAssets').innerHTML = `<span class="${cls(a - GameConfig.initialCash)}">${money(a)}</span>`;
    $('statCash').textContent = money(state.cash);
    $('statPoints').textContent = `${state.pointsLeft}/${GameConfig.research.pointsPerTurn}`;
    renderGoal(state, upto);
    $('newsBox').innerHTML = state.news.map((n) => `<span class="item">${esc(n.headline)}</span>`).join('');
  }

  /** 目标进度：收益率 vs（基准 + 目标），最大回撤 vs 上限。回撤超过上限的 75% 起变橙，超限变红 */
  function renderGoal(state, upto) {
    const p = GameSummary.progress(state, upto);
    const lo = Math.min(-10, p.returnPct, p.benchPct) - 5, hi = Math.max(40, p.targetPct, p.returnPct) + 5;
    const X = (v) => ((v - lo) / (hi - lo)) * 100;
    const zero = X(0), cur = X(p.returnPct);
    const sg = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
    const retHtml = `<div class="meter ${p.returnReached ? 'reached' : ''}">
      <div class="m-head"><span>收益率 <b class="${cls(p.returnPct)}">${sg(p.returnPct)}</b></span>
        <span class="muted">目标 <b class="gold">${sg(p.targetPct)}</b>（基准 ${sg(p.benchPct)} + ${GameConfig.winMarginPct}）${p.returnReached ? ' <b class="up">✔ 已达标</b>' : ''}</span></div>
      <div class="m-track"><div class="m-zero" style="left:${zero}%"></div>
        <div class="m-fill ${p.returnPct >= 0 ? 'pos' : 'neg'}" style="left:${Math.min(zero, cur)}%;width:${Math.abs(cur - zero)}%"></div>
        <div class="m-tick bench" style="left:${X(p.benchPct)}%" title="等权基准 ${sg(p.benchPct)}"></div>
        <div class="m-tick target" style="left:${X(p.targetPct)}%" title="目标线 ${sg(p.targetPct)}"></div></div></div>`;
    const ddMax = p.ddLimit * 1.25, ddPct = (v) => Math.min(100, (v / ddMax) * 100);
    const note = p.ddLevel === 'over' ? '<b class="dd-over">已超上限，本局无法获胜</b>' : p.ddLevel === 'warn' ? '<b class="dd-warn">接近上限！</b>' : '';
    const ddHtml = `<div class="meter dd-${p.ddLevel}">
      <div class="m-head"><span>最大回撤 <b class="dd-val">${(p.maxDD * 100).toFixed(1)}%</b> <span class="muted">（当前距高点 ${(p.curDD * 100).toFixed(1)}%）</span> ${note}</span>
        <span class="muted">上限 <b>${(p.ddLimit * 100).toFixed(0)}%</b>，须低于此值</span></div>
      <div class="m-track"><div class="m-fill dd" style="left:0;width:${ddPct(p.maxDD)}%"></div>
        <div class="m-tick limit" style="left:${ddPct(p.ddLimit)}%" title="回撤上限 ${(p.ddLimit * 100).toFixed(0)}%"></div></div></div>`;
    $('goalBox').innerHTML = retHtml + ddHtml;
  }

  function renderCompanies(state, ui, upto) {
    $('companyList').innerHTML = Object.keys(state.companies).map((id) => {
      const co = state.companies[id];
      const q = quote(state, id, upto);
      const chg = q.price / q.prev - 1;
      const pos = state.positions[id];
      const est = GameResearch.getEstimate(state, id);
      const raw = state.research[id];
      let estHtml, premHtml = '';
      if (est) {
        estHtml = `<span class="est-ok">估值 ${money(est.estimate)} ±${(est.sigma * 100).toFixed(0)}%</span><span>剩余 ${est.remaining} 回合</span>`;
        premHtml = `<span>现价较估值</span><span class="${cls(q.price / est.estimate - 1)}">${pct(q.price / est.estimate - 1, 1)}</span>`;
      } else {
        estHtml = `<span class="est-none">${raw ? '估值已过期' : '未研究'}</span><span></span>`;
      }
      const posHtml = pos
        ? `<span>持仓 ${pos.shares} 股</span><span class="${cls(q.price / pos.avgCost - 1)}">${pct(q.price / pos.avgCost - 1, 1)}</span>`
        : `<span>持仓 —</span><span></span>`;
      return `<div class="company ${id === ui.selected ? 'active' : ''}" data-action="select" data-id="${id}">
        <div class="row1"><span><span class="name">${co.name}</span><span class="ind">${co.industryName}</span></span>
          <span class="price ${cls(chg)}">${fmt(q.price)}</span></div>
        <div class="row2"><span>今日</span><span class="${cls(chg)}">${pct(chg)}</span></div>
        <div class="row3">${estHtml}</div>
        ${premHtml ? `<div class="row4">${premHtml}</div>` : ''}
        <div class="row4">${posHtml}</div>
      </div>`;
    }).join('');
  }

  function chartTitle(state, ui, upto) {
    const co = state.companies[ui.selected];
    const q = quote(state, ui.selected, upto);
    $('chartTitle').innerHTML = `${co.name} <span class="muted">${co.industryName}</span>　<b class="${cls(q.price - q.prev)}">${fmt(q.price)}</b> <span class="${cls(q.price - q.prev)}">${pct(q.price / q.prev - 1)}</span>
      <span class="chart-legend"><b class="up">▲</b>买入 <b class="down">▼</b>卖出 <i class="cost-sample"></i>持仓成本（不含费用）</span>`;
  }

  function renderResearch(state, ui) {
    const id = ui.selected, co = state.companies[id];
    const est = GameResearch.getEstimate(state, id);
    const R = GameConfig.research;
    const left = state.pointsLeft;
    const n = Math.min(ui.researchN, Math.max(left, 1));
    const sigmas = [1, 2, 3].map((p) => `${p}点 ±${(GameResearch.sigmaFor(p) * 100).toFixed(0)}%`).join('　');
    $('researchPanel').innerHTML = `<h3>🔬 研究 · ${co.name}</h3>
      <div class="kv"><span>当前估值</span><b>${est ? money(est.estimate) + ` ±${(est.sigma * 100).toFixed(0)}%` : '—'}</b></div>
      <div class="kv"><span>有效期</span><span>${est ? `剩余 ${est.remaining} 回合` : '无有效估值'}</span></div>
      <div class="kv"><span>本回合剩余研究点</span><b>${left}</b></div>
      <div class="kv muted"><span>误差：${sigmas}</span></div>
      <div class="btns">
        <button data-action="rn" data-d="-1" ${n <= 1 || left < 1 ? 'disabled' : ''}>−</button>
        <b style="min-width:20px;text-align:center">${left < 1 ? 0 : n}</b>
        <button data-action="rn" data-d="1" ${n >= left ? 'disabled' : ''}>+</button>
        <button data-action="research" ${left < 1 ? 'disabled' : ''}>投入 ${left < 1 ? 0 : n} 点研究</button>
      </div>
      <div class="muted" style="margin-top:6px">估值是对"真实价值"的带误差估计，${R.validTurns} 回合后过期；重新研究会覆盖旧估值。</div>`;
  }

  /** 已排队的订单对现金/可卖股数的占用（按现价估算） */
  /** 已排队订单的占用：买单占用现金；卖单占用可卖股数，并按现价估算所得（周一先卖后买，所得可用于买单） */
  function reserved(state, ui) {
    let cash = 0, proceeds = 0; const sell = {};
    for (const o of ui.pending) {
      const px = quote(state, o.id).price, shares = o.lots * GameConfig.lotSize;
      if (o.side === 'buy') cash += shares * px * 1.0003 + GameTrading.calcFee('buy', px, shares).total;
      else { sell[o.id] = (sell[o.id] || 0) + shares; proceeds += shares * px - GameTrading.calcFee('sell', px, shares).total; }
    }
    return { cash, sell, proceeds };
  }

  function limits(state, ui, id) {
    const r = reserved(state, ui);
    const px = quote(state, id).price;
    // 可用资金 = 现金 + 待卖出订单的估算所得（已扣费用） − 待买入订单的占用
    const buyLots = Math.floor(GameTrading.maxAffordable((state.cash + r.proceeds - r.cash) / 1.01, px * 1.0) / GameConfig.lotSize);
    const pos = state.positions[id];
    const sellLots = Math.floor(((pos ? pos.shares : 0) - (r.sell[id] || 0)) / GameConfig.lotSize);
    return { buyLots: Math.max(0, buyLots), sellLots: Math.max(0, sellLots), price: px };
  }

  function renderOrder(state, ui) {
    const id = ui.selected, co = state.companies[id];
    const L = limits(state, ui, id);
    $('orderPanel').innerHTML = `<h3>📝 下单 · ${co.name}</h3>
      <div class="kv"><span>参考价（上周收盘）</span><b>${fmt(L.price)}</b></div>
      <div class="kv"><span>最多可买</span><span>${L.buyLots} 手</span></div>
      <div class="kv"><span>可卖</span><span>${L.sellLots} 手</span></div>
      <div class="kv"><span>数量（手）</span><input type="number" id="lotsInput" min="1" step="1" value="${ui.lots}"></div>
      <div class="btns">
        <button class="small" data-action="fill" data-k="0.25">1/4 仓</button>
        <button class="small" data-action="fill" data-k="0.5">半仓</button>
        <button class="small" data-action="fill" data-k="1">满仓</button>
        <button class="small" data-action="fill" data-k="sell">全部卖出</button>
      </div>
      <div class="btns">
        <button class="buy" data-action="order" data-side="buy">买入</button>
        <button class="sell" data-action="order" data-side="sell">卖出</button>
      </div>`;
  }

  function renderPending(state, ui) {
    const items = ui.pending.map((o, i) => `<div class="pending-item">
      <span><b class="${o.side === 'buy' ? 'up' : 'down'}">${o.side === 'buy' ? '买' : '卖'}</b> ${state.companies[o.id].name} ${o.lots} 手</span>
      <button class="small" data-action="cancel" data-i="${i}">撤销</button></div>`).join('');
    $('pendingPanel').innerHTML = `<h3>⏳ 待执行订单</h3>${items || '<div class="muted">暂无。结束回合时按下周一开盘价成交。</div>'}`;
  }

  function renderLog(state) {
    const w = state.lastWeek;
    if (!w) { $('logPanel').innerHTML = '<div>上周成交记录会显示在这里。</div>'; return; }
    const name = (id) => state.companies[id].name;
    const rows = w.trades.map((t) => `<div>${t.side === 'buy' ? '买入' : '卖出'} ${name(t.id)} ${t.shares}股 @${fmt(t.price)} 费用${fmt(t.fee)}</div>`)
      .concat(w.failed.map((f) => `<div class="err">未成交：${f.order.side === 'buy' ? '买入' : '卖出'} ${name(f.order.id)} ${f.order.shares}股 — ${f.error}</div>`));
    $('logPanel').innerHTML = `<div><b>第 ${w.turn} 回合结果</b></div>${rows.join('') || '<div>本回合无交易。</div>'}`;
  }

  function renderSettlement(state) {
    const r = state.result, el = $('settlement');
    const bust = r.outcome === 'bankrupt';
    const rows = r.truth.map((t) => {
      const est = state.research[t.id];
      return `<tr><td>${t.name}</td><td>${fmt(t.V)}</td><td>${fmt(t.price)}</td>
        <td class="${cls(t.price / t.V - 1)}">${pct(t.price / t.V - 1, 1)}</td>
        <td>${est ? fmt(est.estimate) + ` <span class="muted">(误差 ${pct(est.estimate / t.V - 1, 1)})</span>` : '<span class="muted">未研究</span>'}</td></tr>`;
    }).join('');
    el.innerHTML = `<div class="card">
      <h2>${bust ? '💥 挑战失败' : '🏁 游戏结束'}</h2>
      <div class="sub">${bust ? `第 ${r.turnsPlayed} 回合总资产跌破 ${money(GameConfig.bankruptcyLine)}` : `完成全部 ${GameConfig.totalTurns} 回合`}</div>
      <div class="big">
        <div><span>总资产</span><b>${money(r.totalAssets)}</b></div>
        <div><span>收益率</span><b class="${cls(r.returnPct)}">${(r.returnPct >= 0 ? '+' : '') + r.returnPct.toFixed(2)}%</b></div>
        <div><span>等权持有基准</span><b class="${cls(r.benchmarkReturnPct)}">${(r.benchmarkReturnPct >= 0 ? '+' : '') + r.benchmarkReturnPct.toFixed(2)}%</b></div>
        <div><span>最大回撤</span><b class="down">${(r.maxDrawdown * 100).toFixed(2)}%</b></div>
      </div>
      <div style="margin-bottom:14px">${r.win ? '<b class="up">✔ 胜利</b>' : '<b class="muted">✘ 未达成胜利</b>'}
        <span class="muted">　条件：打完 ${GameConfig.totalTurns} 回合，收益率 ≥ 基准 + ${GameConfig.winMarginPct} 个百分点（你 ${(r.returnPct - r.benchmarkReturnPct >= 0 ? '+' : '') + (r.returnPct - r.benchmarkReturnPct).toFixed(2)}），且最大回撤 &lt; ${(GameConfig.winMaxDrawdown * 100).toFixed(0)}%（你 ${(r.maxDrawdown * 100).toFixed(1)}%）</span></div>
      <div class="muted" style="margin-bottom:6px">真相揭晓：每家公司的真实价值</div>
      <table><tr><th>公司</th><th>真实价值 V</th><th>期末股价</th><th>价格偏离</th><th>你最后一次估值</th></tr>${rows}</table>
      <div class="export-msg muted" id="exportMsg"></div>
      <div class="actions"><button data-action="export">💾 导出本局记录</button> <button data-action="review-open">📊 查看复盘</button> <button class="primary" data-action="restart-confirmed">再来一局</button></div>
    </div>`;
    el.hidden = false;
  }

  function hideSettlement() { $('settlement').hidden = true; }

  /** 完整渲染（upto：回放时只显示前 N 根K线对应的价格） */
  function renderAll(state, ui, upto) {
    renderTopbar(state, upto);
    renderCompanies(state, ui, upto);
    chartTitle(state, ui, upto);
    renderResearch(state, ui);
    renderOrder(state, ui);
    renderPending(state, ui);
    renderLog(state);
    $('btnEndTurn').disabled = state.status !== 'playing' || ui.busy;
  }

  return { renderAll, renderCompanies, renderTopbar, chartTitle, renderSettlement, hideSettlement, limits, quote };
})();
