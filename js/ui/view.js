/* ui/view.js — 纯渲染：把 state + ui 状态画到 DOM（不改 state） */
const GameView = (() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (n) => '¥' + fmt(n);
  const pct = (x, d = 2) => (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%';
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  /** 分数的颜色：加分金色、扣分红色（不用红涨绿跌：红色在这里只表示扣分，绿色不用来表示扣分） */
  const scls = (x) => (x > 0.0005 ? 'sp' : x < -0.0005 ? 'pen' : '');
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

  const sgn = (v, d = 1) => (v >= 0 ? '+' : '') + v.toFixed(d);
  const GRADE_NAME = { S: 'S', A: 'A', B: 'B', C: 'C', D: 'D' };

  /** 顶部评分条：当前总分（"若现在结束"）、预估等级、本季度目前得分、距下一等级还差多少分；下面是收益率/回撤/季度分 */
  function renderGoal(state, upto) {
    const p = GameSummary.progress(state, upto), T = GameTips.tip, C = GameConfig.scoring, G = C.grades;
    const sc = p.score, Q = p.quarter;
    // 等级尺：D | C | B | A | S，标记 = 当前总分
    const top = G.S * 1.25, lo = Math.min(0, sc.total) - 5, hi = Math.max(top, sc.total + 5);
    const X = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    const seg = (from, to, g) => `<div class="g-seg g-${g}" style="left:${X(from)}%;width:${X(to) - X(from)}%"><span>${g}</span></div>`;
    const ruler = `<div class="g-ruler">${seg(lo, G.C, 'D')}${seg(G.C, G.B, 'C')}${seg(G.B, G.A, 'B')}${seg(G.A, G.S, 'A')}${seg(G.S, hi, 'S')}<div class="g-mark" style="left:${X(sc.total)}%"></div></div>
      <div class="g-lines">${['C', 'B', 'A', 'S'].map((g) => `<span style="left:${X(G[g])}%">${g} ${G[g]}</span>`).join('')}</div>`;
    const started = p.started;
    const gradeHtml = started ? `<b class="grade-pill g-${sc.grade}">${GRADE_NAME[sc.grade]}</b> <span class="muted">${sc.pass ? '过关线以上' : '未到过关线 B'}</span>` : '<b class="grade-pill g-none">—</b> <span class="muted">第 1 回合结束后显示</span>';
    // 距下一等级：差距超过剩余回合理论上还能拿到的分数的一半时不再显示（只看本季度目标）
    const nextTxt = !started ? '' : !sc.next ? '<b class="grade-txt g-S">已是最高等级 S</b>'
      : p.nextTooFar ? '' : `距 <b class="grade-txt g-${sc.next.grade}">${sc.next.grade}</b> 还差 <b>${sc.next.need.toFixed(1)}</b> 分`;
    // 本季度：目前得分 + 目标
    const qtarget = Q.limit === 'max' ? `<b class="sp">本季度已封顶</b> <span class="muted">（上限 ${Q.scoreMax} 分，再多赚也不加分）</span>`
      : Q.limit === 'min' ? `<b class="pen">本季度已触底</b> <span class="muted">（下限 ${Q.scoreMin} 分，再多亏也不再多扣）</span>`
      : (Q.diff <= 0
        ? `目标：超额 &gt; 0 即得基础分 <b>+${Q.beatBase}</b>${Q.gapToBase > 0 ? `（还差 <b>${Q.gapToBase.toFixed(2)}</b> 点）` : ''}`
        : `已拿到基础分 <b>+${Q.beatBase}</b>`)
        + (Q.targetCap != null ? `；超额达 <b>${sgn(Q.targetCap, 0)} 点</b>拿满 <b>${Q.scoreMax}</b>${Q.gapToCap > 0 ? `（还差 ${Q.gapToCap.toFixed(2)} 点）` : ''}` : '');
    const scoreHtml = `<div class="scorebar">
      <div class="sc-quarter">
        <div class="scq-head">第 <b>${Q.q}</b>/${Q.total} 季度 · 第 <b>${Q.turnInQuarter}</b>/${Q.length} 回合${T(`每 ${Q.length} 回合是一个季度，共 ${Q.total} 个季度，季度末结算一次季度分：你的季度收益率比基准同一季度高就得 ${C.quarter.beatBase} 分基础分，超额每 1 个百分点再${C.quarter.perPoint >= 0 ? '加' : '减'} ${Math.abs(C.quarter.perPoint)} 分（超额为负则按同样比例扣分）；单季度限制在 ${C.quarter.min} 到 ${C.quarter.max} 分之间。每个季度都是一个新的起点。`)}</div>
        <div class="scq-score"><span class="muted">本季度目前得分</span> <b class="scq-num ${scls(Q.score)}">${sgn(Q.score)}</b></div>
        <div class="scq-target">${qtarget}</div>
        <div class="scq-diff muted">本季度相对基准 <b class="${cls(Q.diff)}">${sgn(Q.diff)} 点</b>（你 ${sgn(Q.playerPct)}% / 基准 ${sgn(Q.benchPct)}%）</div>
      </div>
      <div class="sc-main sc-sub">
        <span class="sc-item">总分（若现在结束）${T(`总分 = 4 个季度分 + 终局分 − 回撤扣分，最低 ${C.totalMin}。这里是"如果现在结束"的得分：已完成季度的得分 + 进行中季度目前的得分 + 按当前全局超额算的终局分 − 回撤扣分（当前 ${sgn(sc.quarterTotal)} ${sgn(sc.final)} −${sc.penalty.toFixed(1)}）。`)} <b class="sc-total ${scls(sc.total)}">${sgn(sc.total)}</b></span>
        <span class="sc-item">预估等级${T(`按总分评级：S ≥ ${G.S}，A ≥ ${G.A}，B ≥ ${G.B}，C ≥ ${G.C}，更低为 D。B 及以上视为过关。分数线是游戏平衡测试里研究型玩家的得分分布定的。`)} ${gradeHtml}</span>
        <span class="sc-item sc-next">${nextTxt}</span>
      </div>${ruler}</div>`;

    const lo2 = Math.min(-10, p.returnPct, p.benchPct) - 5, hi2 = Math.max(40, p.returnPct, p.benchPct) + 5;
    const X2 = (v) => ((v - lo2) / (hi2 - lo2)) * 100;
    const zero = X2(0), cur = X2(p.returnPct);
    const retHtml = `<div class="meter">
      <div class="m-head"><span>收益率 <b class="${cls(p.returnPct)}">${sgn(p.returnPct)}%</b>${T(`你的总资产相对本金 ¥${GameConfig.initialCash.toLocaleString('zh-CN')} 的涨跌幅。终局分按它与基准的差（全局超额收益）计算。`)}</span>
        <span class="muted">基准 <b>${sgn(p.benchPct)}%</b>${T('基准 = 开局第一天把本金平均买入 4 家公司并一直持有的收益率（不计手续费）。它代表"什么都不琢磨"的人的成绩。', 'r')}　全局超额 <b class="${cls(sc.finalExcess)}">${sgn(sc.finalExcess)} 点</b></span></div>
      <div class="m-track"><div class="m-zero" style="left:${zero}%"></div>
        <div class="m-fill ${p.returnPct >= 0 ? 'pos' : 'neg'}" style="left:${Math.min(zero, cur)}%;width:${Math.abs(cur - zero)}%"></div>
        <div class="m-tick bench" style="left:${X2(p.benchPct)}%" title="等权基准 ${sgn(p.benchPct)}%"></div></div></div>`;
    const ddMax = Math.max(0.12, p.maxDD * 1.2), ddPct = (v) => Math.min(100, (v / ddMax) * 100);
    const ddLevel = p.ddPenalty > 0 ? 'warn' : 'ok';
    const ddHtml = `<div class="meter dd-${ddLevel}">
      <div class="m-head"><span>超额回撤 <b class="dd-val">${(p.maxDD * 100).toFixed(1)}%</b>${T(`最大回撤（超额回撤）= 你的总资产相对基准的净值（总资产 ÷ 基准）从历史最高点回落的最大幅度，按每周收盘计算，不计盘中回落。只有"跑输基准"的部分才算：大盘下跌时你跌得比基准少，不扣分。超过 ${(p.ddThreshold * 100).toFixed(0)}% 的部分每超出 1 个百分点扣 ${C.drawdown.perPoint} 分，最多扣 ${C.drawdown.maxPenalty} 分。`)} <span class="muted">（当前离最高点 ${(p.curDD * 100).toFixed(1)}%）</span></span>
        <span class="muted">${p.ddPenalty > 0 ? `已扣 <b class="pen">${p.ddPenalty.toFixed(1)}</b> 分${p.ddCapped ? '（已达扣分上限）' : ''}` : `超过 <b>${(p.ddThreshold * 100).toFixed(0)}%</b> 才开始扣分`}</span></div>
      <div class="m-track"><div class="m-fill dd" style="left:0;width:${ddPct(p.maxDD)}%"></div>
        <div class="m-tick limit" style="left:${ddPct(p.ddThreshold)}%" title="超过 ${(p.ddThreshold * 100).toFixed(0)}% 开始扣分"></div></div></div>`;
    const pills = Q.pills.map((k, i) => `<span class="q-pill ${k.state}" title="第 ${i + 1} 季度${k.state === 'done' ? '（已结束）' : k.state === 'cur' ? '（进行中，得分为目前的）' : ''}">${i + 1}${k.state === 'future' ? ' ·' : ` <b>${sgn(k.score)}</b>`}</span>`).join('');
    const qHtml = `<div class="meter quarter">
      <div class="m-head"><span>四个季度的得分</span><span class="muted">已结束 ${Q.completed}/${Q.total} 个季度</span></div>
      <div class="q-pills">${pills}</div></div>`;
    $('goalBox').innerHTML = scoreHtml + retHtml + ddHtml + qHtml;
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

  // ── 操作提示（toast）：挂在研究/下单面板的按钮旁边，约 4 秒后自动消失 ──
  const TOAST_MS = 4000;
  const toasts = {};   // where → { msg, until, timer }
  const toastHtml = (where) => {
    const t = toasts[where];
    return `<div class="op-toast ${t && t.until > Date.now() ? 'show' : ''}" data-where="${where}" role="alert">${t && t.until > Date.now() ? esc(t.msg) : ''}</div>`;
  };
  /** 面板重绘后，提示还在有效期内就保持显示（toastHtml 已处理）；这里负责出现、重播动画与定时消失 */
  function showToast(where, msg) {
    const t = toasts[where] || (toasts[where] = {});
    clearTimeout(t.timer);
    t.msg = msg; t.until = Date.now() + TOAST_MS;
    const el = document.querySelector(`.op-toast[data-where="${where}"]`);
    if (el) {
      el.textContent = msg; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');   // 重启动画
      const panel = el.closest('.panel'); if (panel) { panel.classList.remove('shake'); void panel.offsetWidth; panel.classList.add('shake'); }
    }
    t.timer = setTimeout(() => {
      const e2 = document.querySelector(`.op-toast[data-where="${where}"]`);
      if (e2) { e2.classList.remove('show'); e2.textContent = ''; }
    }, TOAST_MS);
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
      ${toastHtml('research')}
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
      </div>
      ${toastHtml('order')}`;
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
  const sg1 = (v) => (v >= 0 ? '+' : '') + v.toFixed(1);

  /** 一个季度的得分构成：基础分 + 超额分，触及上下限时注明 */
  function quarterParts(x) {
    const c = GameConfig.scoring.quarter;
    const parts = [x.base ? `跑赢基础分 ${x.base}` : '未跑赢（无基础分）', `超额 ${sg2(x.excess)} 点 × ${c.perPoint} = ${sg2(x.bonus)}`];
    return parts.join(' ＋ ') + (x.clamped ? `　→ 触及${x.raw > x.score ? '上' : '下'}限 ${x.score}` : '');
  }

  /** 分数构成明细表（结算页 / 季度成绩单共用）：季度分、终局分、回撤扣分、总分 */
  function scoreTableHtml(sc, opts) {
    const F = GameConfig.scoring.final, D = GameConfig.scoring.drawdown;
    const rows = Array.from({ length: GameConfig.quarters }, (_, i) => {
      const x = sc.quarters[i];
      return x ? `<tr><td>第 ${i + 1} 季度分</td><td class="l">${quarterParts(x)}</td><td class="${scls(x.score)}"><b>${sg1(x.score)}</b></td></tr>`
        : `<tr><td>第 ${i + 1} 季度分</td><td class="l muted">${opts && opts.partial ? '尚未结束' : '未打到'}</td><td class="muted">—</td></tr>`;
    }).join('');
    const fin = sc.final;
    return `<table class="qtable"><tr><th>项目</th><th class="l">构成</th><th>得分</th></tr>${rows}
      <tr><td>终局分</td><td class="l">全局超额 ${sg2(fin.excess)} 点 × ${F.perPoint} = ${sg2(fin.raw)}${fin.clamped ? `　→ 触及${fin.raw > fin.score ? '上' : '下'}限 ${fin.score}` : ''}</td><td class="${scls(fin.score)}"><b>${sg1(fin.score)}</b></td></tr>
      <tr><td>回撤扣分</td><td class="l">超额回撤 ${(sc.drawdown.maxDD * 100).toFixed(2)}%（相对基准净值从最高点回落），超过 ${(D.threshold * 100).toFixed(0)}% 的部分 ${sc.drawdown.overPoints.toFixed(2)} 个百分点 × ${D.perPoint}${sc.drawdown.capped ? `　→ 触及扣分上限 ${D.maxPenalty}` : ''}</td><td class="${sc.drawdown.penalty > 0 ? 'pen' : ''}"><b>${sc.drawdown.penalty > 0 ? '−' : ''}${sc.drawdown.penalty.toFixed(1)}</b></td></tr>
      <tr class="qt-total"><td>${opts && opts.partial ? '目前总分（若现在结束）' : '总分'}</td><td class="l">季度分合计 ${sg1(sc.quarterTotal)} ＋ 终局分 ${sg1(fin.score)} − 回撤扣分 ${sc.drawdown.penalty.toFixed(1)}${sc.totalFloored ? `　→ 触及总分下限 ${GameConfig.scoring.totalMin}` : ''}</td><td><b>${sg1(sc.total)}</b></td></tr></table>`;
  }

  /** 季度成绩单（每个季度结束时弹出） */
  function renderQuarterReport(state, q) {
    const L = GameConfig.quarterLength, d = q * L * GameConfig.daysPerTurn;
    const sc = GameState.scoreSnapshot(state, d), x = sc.quarters[q - 1], qa = GameState.quarterAt(state, q, d);
    const lines = GameConfig.scoring.grades, nxt = GameScoring.nextGrade(sc.total);
    const last = q >= GameConfig.quarters || state.status === 'ended';
    const el = $('quarter');
    el.innerHTML = `<div class="card weekly-card">
      <h2>第 ${q} 季度成绩单 <span class="muted" style="font-size:13px;font-weight:400">（第 ${(q - 1) * L + 1}–${q * L} 回合）</span></h2>
      <div class="sub">本季度你的收益率与等权基准的本季度收益率比较（基准在季度内同样是一直持有）。</div>
      <div class="wk-big"><div><span>你的本季度收益率</span><b class="${cls(qa.playerPct)}">${sg2(qa.playerPct)}%</b></div>
        <div><span>基准本季度收益率</span><b class="${cls(qa.benchPct)}">${sg2(qa.benchPct)}%</b></div>
        <div><span>两者之差（超额）</span><b class="${cls(x.excess)}">${sg2(x.excess)} 点</b></div>
        <div><span>本季度得分</span><b class="${scls(x.score)}">${sg1(x.score)}</b></div></div>
      <div class="q-note">${GameSummary.quarterNote(qa.playerPct, qa.benchPct)}</div>
      <div style="margin-bottom:6px;font-size:13px" class="muted">得分构成：${quarterParts(x)}</div>
      ${scoreTableHtml(sc, { partial: true })}
      <div style="margin:6px 0 4px">按目前的总分，预估等级 <b class="grade-pill g-${sc.grade}">${sc.grade}</b>（${sc.pass ? '已在过关线 B 以上' : `过关线 B = ${lines.B} 分`}）。${nxt ? `距 ${nxt.grade} 还差 <b>${nxt.need.toFixed(1)}</b> 分。` : '已是最高等级。'}</div>
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
        <div><span>超额回撤${GameTips.tip('你的总资产相对基准净值，从历史最高点回落的最大幅度（按每周收盘），参与回撤扣分。账户自身的最大回撤是 ' + (r.maxDrawdown * 100).toFixed(2) + '%，只供参考。', 'r')}</span><b class="pen">${(r.excessDrawdown * 100).toFixed(2)}%</b></div>
      </div>
      <div class="grade-hero"><div class="gh-grade g-${r.grade}">${r.grade}</div>
        <div><div class="gh-total">总分 <b class="${scls(r.score.total)}">${sg1(r.score.total)}</b></div>
          <div class="${r.pass ? 'up' : 'muted'}" style="font-size:15px"><b>${r.pass ? '✔ 过关' : '✘ 未过关'}</b> <span class="muted" style="font-size:12px">（B 及以上过关；等级线 S ${GameConfig.scoring.grades.S} / A ${GameConfig.scoring.grades.A} / B ${GameConfig.scoring.grades.B} / C ${GameConfig.scoring.grades.C}）${bust ? '　中途判负：一律评为 D' : ''}</span></div></div></div>
      ${scoreTableHtml(r.score)}
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

  return { renderAll, renderCompanies, renderTopbar, chartTitle, renderSettlement, hideSettlement, renderQuarterReport, hideQuarterReport, showToast, limits, quote };
})();
