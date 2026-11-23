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
    // week：近一周（最近 5 个交易日）累计涨跌，与回合小结里的"本周累计涨跌"同口径
    return { price: c[n - 1].close, prev: n >= 2 ? c[n - 2].close : c[n - 1].open, week: c[n - 1].close / c[Math.max(0, n - 1 - GameConfig.daysPerTurn)].close - 1 };
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
    const T = GameTips.tip, Xm = GameConfig.winMarginPct, Yp = (GameConfig.winMaxDrawdown * 100).toFixed(0);
    const retHtml = `<div class="meter ${p.returnReached ? 'reached' : ''}">
      <div class="m-head"><span>收益率 <b class="${cls(p.returnPct)}">${sg(p.returnPct)}</b>${T(`你的总资产相对本金 ¥${GameConfig.initialCash.toLocaleString('zh-CN')} 的涨跌幅。胜利要求它不低于"目标线"。`)}</span>
        <span class="muted">目标 <b class="gold">${sg(p.targetPct)}</b>${T(`目标线 = 基准收益率 + ${Xm} 个百分点。基准每周都在变，所以目标线会跟着移动。`, 'r')}（基准${T('基准 = 开局第一天把本金平均买入 4 家公司并一直持有的收益率（不计手续费）。它代表"什么都不琢磨"的人的成绩。', 'r')} ${sg(p.benchPct)} + ${Xm}）${p.returnReached ? ' <b class="up">✔ 已达标</b>' : ''}</span></div>
      <div class="m-track"><div class="m-zero" style="left:${zero}%"></div>
        <div class="m-fill ${p.returnPct >= 0 ? 'pos' : 'neg'}" style="left:${Math.min(zero, cur)}%;width:${Math.abs(cur - zero)}%"></div>
        <div class="m-tick bench" style="left:${X(p.benchPct)}%" title="等权基准 ${sg(p.benchPct)}"></div>
        <div class="m-tick target" style="left:${X(p.targetPct)}%" title="目标线 ${sg(p.targetPct)}"></div></div></div>`;
    const ddMax = p.ddLimit * 1.25, ddPct = (v) => Math.min(100, (v / ddMax) * 100);
    const note = p.ddLevel === 'over' ? '<b class="dd-over">已超上限，本局无法获胜</b>' : p.ddLevel === 'warn' ? '<b class="dd-warn">接近上限！</b>' : '';
    const ddHtml = `<div class="meter dd-${p.ddLevel}">
      <div class="m-head"><span>最大回撤 <b class="dd-val">${(p.maxDD * 100).toFixed(1)}%</b>${T(`从总资产历史最高点回落的最大幅度（按每日总资产计算）。整局必须低于 ${Yp}% 才算胜利。"当前距高点"是此刻离最高点已经回落了多少；"最大回撤"是历史上回落得最深的一次，只增不减。`)} <span class="muted">（当前距高点 ${(p.curDD * 100).toFixed(1)}%）</span> ${note}</span>
        <span class="muted">上限 <b>${(p.ddLimit * 100).toFixed(0)}%</b>，须低于此值</span></div>
      <div class="m-track"><div class="m-fill dd" style="left:0;width:${ddPct(p.maxDD)}%"></div>
        <div class="m-tick limit" style="left:${ddPct(p.ddLimit)}%" title="回撤上限 ${(p.ddLimit * 100).toFixed(0)}%"></div></div></div>`;
    const Q = p.quarter, sgp = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);
    const pillTxt = { beat: '✔', miss: '✘', cur: '●', future: '·' };
    const pills = Q.pills.map((k, i) => `<span class="q-pill ${k}" title="第 ${i + 1} 季度">${i + 1}${pillTxt[k]}</span>`).join('');
    const qHtml = `<div class="meter quarter ${Q.impossible ? 'q-impossible' : ''}">
      <div class="m-head"><span>季度考核${T(`每 ${Q.length} 回合为一个季度，共 ${Q.total} 个季度。某季度你的收益率高于基准同一季度的收益率，就算"跑赢"。${Q.total} 个季度中至少跑赢 ${Q.need} 个才能胜利。`)} · 第 <b>${Q.q}</b>/${Q.total} 季度 第 <b>${Q.turnInQuarter}</b>/${Q.length} 回合　本季度相对基准 <b class="${cls(Q.diff)}">${sgp(Q.diff)} 点</b> <span class="muted">（你 ${sgp(Q.playerPct)}% / 基准 ${sgp(Q.benchPct)}%）</span></span>
        <span>已跑赢 <b>${Q.beaten}/${Q.total}</b> 个季度 <span class="muted">（至少 ${Q.need}）</span> ${Q.impossible ? '<b class="dd-over">季度条件已无法满足</b>' : ''}</span></div>
      <div class="q-pills">${pills}</div></div>`;
    $('goalBox').innerHTML = retHtml + ddHtml + qHtml;
  }

  /** 估值区间：真实价值约有 68% 的把握落在 [估值·e^-σ, 估值·e^σ] 内（σ = 研究误差的标准差） */
  function rangeOf(est) { return { lo: est.estimate * Math.exp(-est.sigma), hi: est.estimate * Math.exp(est.sigma) }; }

  /** 区间条：金色段 = 约 68% 把握区间，竖线 = 估值，白色三角 = 现价 */
  function rangeBar(est, price, big) {
    const { lo, hi } = rangeOf(est);
    const min = Math.min(lo, price) * 0.97, max = Math.max(hi, price) * 1.03;
    const X = (v) => ((v - min) / (max - min)) * 100;
    return `<div class="rbar ${big ? 'big' : ''}" title="区间 ¥${fmt(lo)} – ¥${fmt(hi)}：真实价值约 68% 的把握在此区间内">
      <div class="rb-track"><div class="rb-range" style="left:${X(lo)}%;width:${X(hi) - X(lo)}%"></div><div class="rb-est" style="left:${X(est.estimate)}%"></div><div class="rb-px" style="left:${X(price)}%"></div></div>
      <div class="rb-lbl"><span>¥${fmt(lo)}</span><span class="muted">${big ? '约 68% 把握在此区间内' : '约68%把握'}</span><span>¥${fmt(hi)}</span></div></div>`;
  }

  const staleBadge = (id) => `<button class="stale-badge" data-action="stale-news" data-id="${id}" title="点击查看是哪几条新闻">研究后出现相关新闻</button>`;

  /** 估值剩余有效回合：只剩最后 1 回合时用橙色提醒 */
  const remainHtml = (est) => est.remaining <= 1
    ? '<span class="expiring" title="这条估值本回合还有效，下回合起过期">最后 1 回合有效</span>'
    : `<span>剩余 ${est.remaining} 回合</span>`;

  const TIP_DAY = '最近一个交易日相对前一个交易日的涨跌（这是按周玩的游戏，所以只是上周最后一天的变化）。';
  const TIP_WEEK = '最近 5 个交易日（一周）的累计涨跌，口径和回合小结里的“本周累计涨跌”一致。';

  function renderCompanies(state, ui, upto) {
    $('companyList').innerHTML = Object.keys(state.companies).map((id, idx) => {
      const co = state.companies[id];
      const q = quote(state, id, upto);
      const chg = q.price / q.prev - 1;
      const pos = state.positions[id];
      const est = GameResearch.getEstimate(state, id);
      const raw = state.research[id];
      let estHtml, premHtml = '', rangeHtml = '';
      const staleNews = est ? GameSummary.newsSinceResearch(state, id).length : 0;
      if (est) {
        estHtml = `<span class="est-ok">估值 ${money(est.estimate)}</span>${remainHtml(est)}`;
        rangeHtml = rangeBar(est, q.price, false);
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
        <div class="row2"><span title="${TIP_DAY}">最近一日${idx === 0 ? GameTips.tip(TIP_DAY) : ''}</span><span class="${cls(chg)}">${pct(chg)}</span></div>
        <div class="row2"><span title="${TIP_WEEK}">近一周${idx === 0 ? GameTips.tip(TIP_WEEK) : ''}</span><span class="${cls(q.week)}">${pct(q.week)}</span></div>
        <div class="row3">${estHtml}</div>
        ${rangeHtml}
        ${premHtml ? `<div class="row4">${premHtml}</div>` : ''}
        ${staleNews ? staleBadge(id) : ''}
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
    const sigmas = [1, 2, 3].map((p) => `${p} 点约 ${(GameResearch.sigmaFor(p) * 100).toFixed(0)}%`).join('，');
    const hint = GameTips.tip(`研究得到的是对"真实价值"的估计，带有随机误差：真实价值约有 68% 的把握落在区间内。投入的研究点越多，区间越窄（区间半宽：${sigmas}）。`);
    $('researchPanel').innerHTML = `<h3>🔬 研究 · ${co.name}</h3>
      <div class="kv"><span>当前估值${hint}</span><b>${est ? money(est.estimate) : '—'}</b></div>
      ${est ? rangeBar(est, quote(state, id).price, true) : ''}
      <div class="kv"><span>有效期</span>${est ? remainHtml(est) : '<span>无有效估值</span>'}</div>
      ${est && GameSummary.newsSinceResearch(state, id).length ? `<div class="kv">${staleBadge(id)}</div>` : ''}
      <div class="kv"><span>本回合剩余研究点</span><b>${left}</b></div>
      <div class="kv muted"><span>区间半宽：${sigmas}</span></div>
      ${left < 1 ? `<div class="muted" style="margin-top:8px">本回合研究点已用完，下回合恢复到 ${R.pointsPerTurn} 点。</div>` : `<div class="btns">
        <button data-action="rn" data-d="-1" ${n <= 1 ? 'disabled' : ''}>−</button>
        <b style="min-width:20px;text-align:center">${n}</b>
        <button data-action="rn" data-d="1" ${n >= left ? 'disabled' : ''}>+</button>
        <button data-action="research">投入 ${n} 点研究</button>
      </div>`}
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
      <div class="kv"><span>最多可买</span><span>${L.buyLots} 手${GameTips.tip(`1 手 = ${GameConfig.lotSize} 股，买卖的最小单位。按参考价，1 手 ≈ ¥${fmt(L.price * GameConfig.lotSize)}。`, 'r')}</span></div>
      <div class="kv"><span>可卖</span><span>${L.sellLots} 手</span></div>
      <div class="kv"><span>数量（手${GameTips.tip(`1 手 = ${GameConfig.lotSize} 股。`)}）</span><input type="number" id="lotsInput" min="1" step="1" value="${ui.lots}"></div>
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

  const sg2 = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);

  /** 三条胜利条件逐条列出，写清"差多少" */
  function conditionsHtml(r) {
    const X = GameConfig.winMarginPct, Y = GameConfig.winMaxDrawdown * 100, Z = GameConfig.winMinQuarters;
    const gap = r.returnPct - r.benchmarkReturnPct;
    const c1 = r.outcome === 'completed' && gap >= X, c2 = r.maxDrawdown * 100 < Y, c3 = r.quartersBeaten >= Z;
    const li = (ok, txt) => `<li class="${ok ? 'ok' : 'no'}"><b>${ok ? '✔' : '✘'}</b> ${txt}</li>`;
    return `<ul class="conds">
      ${li(c1, `总收益率比基准高出至少 ${X} 个百分点：你的收益率 ${sg2(r.returnPct)}%，基准 ${sg2(r.benchmarkReturnPct)}%，<b>${gap >= 0 ? '高出' : '低于'} ${Math.abs(gap).toFixed(2)} 点</b>（需 ≥ ${X}）${r.outcome === 'bankrupt' ? '（中途判负）' : ''}`)}
      ${li(c2, `最大回撤低于 ${Y.toFixed(0)}%：你的最大回撤 ${(r.maxDrawdown * 100).toFixed(2)}%`)}
      ${li(c3, `${GameConfig.quarters} 个季度中至少 ${Z} 个跑赢基准：你跑赢了 <b>${r.quartersBeaten}</b> 个`)}</ul>`;
  }

  function quarterTableHtml(quarters) {
    const rows = Array.from({ length: GameConfig.quarters }, (_, i) => {
      const x = quarters[i];
      return x ? `<tr><td>第 ${i + 1} 季度</td><td class="${cls(x.playerPct)}">${sg2(x.playerPct)}%</td><td class="${cls(x.benchPct)}">${sg2(x.benchPct)}%</td>
        <td class="${cls(x.diff)}">${sg2(x.diff)} 点</td><td>${x.beat ? '<b class="up">✔ 跑赢</b>' : '<span class="muted">✘ 未跑赢</span>'}</td></tr>`
        : `<tr><td>第 ${i + 1} 季度</td><td colspan="4" class="muted">未打到</td></tr>`;
    }).join('');
    return `<table class="qtable"><tr><th>季度成绩</th><th>你的收益率</th><th>基准收益率</th><th>差距</th><th>结果</th></tr>${rows}</table>`;
  }

  /** 季度成绩单（每个季度结束时弹出） */
  function renderQuarterReport(state, q) {
    const res = GameState.quarterResults(state);
    const x = res[q - 1], beaten = res.filter((r) => r.beat).length, Z = GameConfig.winMinQuarters;
    const left = GameConfig.quarters - res.length, need = Math.max(0, Z - beaten);
    const L = GameConfig.quarterLength;
    const status = beaten + left < Z ? '<b class="dd-over">已无法满足季度条件，本局无法获胜（仍可继续玩）。</b>'
      : need === 0 ? '<b class="up">季度条件已满足 ✔</b>（其余两条仍需达成）'
      : `还剩 ${left} 个季度，至少还需跑赢 <b>${need}</b> 个。`;
    const last = q >= GameConfig.quarters || state.status === 'ended';
    const el = $('quarter');
    el.innerHTML = `<div class="card weekly-card">
      <h2>第 ${q} 季度成绩单 <span class="muted" style="font-size:13px;font-weight:400">（第 ${(q - 1) * L + 1}–${q * L} 回合）</span></h2>
      <div class="sub">本季度的收益率与等权基准的本季度收益率比较（基准在季度内同样是一直持有）。</div>
      <div class="wk-big"><div><span>你的本季度收益率</span><b class="${cls(x.playerPct)}">${sg2(x.playerPct)}%</b></div>
        <div><span>基准本季度收益率</span><b class="${cls(x.benchPct)}">${sg2(x.benchPct)}%</b></div>
        <div><span>差距</span><b class="${cls(x.diff)}">${sg2(x.diff)} 点</b></div></div>
      <div style="margin-bottom:12px;font-size:15px">${x.beat ? '<b class="up">✔ 本季度跑赢基准</b>' : '<b class="muted">✘ 本季度未跑赢基准</b>'}</div>
      ${quarterTableHtml(res)}
      <div style="margin:10px 0 4px">累计跑赢 <b>${beaten}/${GameConfig.quarters}</b> 个季度（胜利至少需要 ${Z} 个）。${status}</div>
      <div class="actions"><button class="primary" data-action="quarter-close" id="btnQuarterClose">${last ? '查看结算 ▶' : '继续 ▶'}</button></div>
    </div>`;
    el.hidden = false;
    const b = document.getElementById('btnQuarterClose'); if (b) b.focus();
  }
  function hideQuarterReport() { $('quarter').hidden = true; }

  function renderSettlement(state) {
    const r = state.result, el = $('settlement');
    const bust = r.outcome === 'bankrupt';
    const rows = r.truth.map((t) => {
      const est = state.research[t.id];
      const expired = est && !GameResearch.getEstimate(state, t.id);
      // 研究的准确度要和"研究当时"的真实价值比（之后真实价值还会变），不是和期末价值比
      const rl = est && state.researchLog.filter((r) => r.id === t.id && r.turn === est.turn).slice(-1)[0];
      return `<tr><td>${t.name}</td><td>${fmt(t.V)}</td><td>${fmt(t.price)}</td>
        <td class="${cls(t.price / t.V - 1)}">${pct(t.price / t.V - 1, 1)}</td>
        <td>${est ? fmt(est.estimate) + ` <span class="muted">（第 ${est.turn} 回合研究${expired ? '，<b>已过期</b>' : ''}${rl ? `；当时真实价值 ${fmt(rl.trueV)}，估值误差 ${pct(est.estimate / rl.trueV - 1, 1)}` : ''}）</span>` : '<span class="muted">未研究</span>'}</td></tr>`;
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
      <div style="margin-bottom:8px">${r.win ? '<b class="up" style="font-size:16px">✔ 胜利</b>' : '<b class="muted" style="font-size:16px">✘ 未达成胜利</b>'}<span class="muted">　需要同时满足以下三条：</span></div>
      ${conditionsHtml(r)}
      ${quarterTableHtml(r.quarters)}
      <div class="muted" style="margin-bottom:6px">真相揭晓：每家公司的真实价值</div>
      <table><tr><th>公司</th><th>真实价值 V</th><th>期末股价</th><th>价格偏离</th><th>你最后一次研究的估值</th></tr>${rows}</table>
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

  return { renderAll, renderCompanies, renderTopbar, chartTitle, renderSettlement, hideSettlement, renderQuarterReport, hideQuarterReport, limits, quote };
})();
