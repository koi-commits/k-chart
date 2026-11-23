/* ui/review.js — 结算后的复盘页
   每家公司一张图：日K（红涨绿跌）+ 真实价值 V 折线（蓝）+ 事件回合 + 你的买卖 + 你的研究估值。
   用自绘 SVG，不依赖 lightweight-charts（动态创建的系列在 UMD 构建里有已知问题）。 */
const GameReview = (() => {
  const fmt = (n) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (x, d = 1) => (x >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%';
  const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const W = 920, H = 300, ML = 8, MR = 58, MT = 22, MB = 22;

  /** 回合 t（1 起）第 1 个交易日在 candles 里的下标 */
  const turnStartIdx = (t) => GameConfig.warmupWeeks * GameConfig.daysPerTurn + (t - 1) * GameConfig.daysPerTurn;

  function chartSvg(state, id) {
    const c = state.candles[id], v = state.vPath[id], n = c.length;
    const warm = turnStartIdx(1);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { lo = Math.min(lo, c[i].low, v[i]); hi = Math.max(hi, c[i].high, v[i]); }
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const pw = W - ML - MR, ph = H - MT - MB, step = pw / n;
    const X = (i) => ML + (i + 0.5) * step;
    const Y = (p) => MT + (1 - (p - lo) / (hi - lo)) * ph;
    const bw = Math.max(1.5, step * 0.65);
    const o = [];

    o.push(`<rect x="${ML}" y="${MT}" width="${warm * step}" height="${ph}" class="rv-warm"/>`);
    o.push(`<text x="${ML + 4}" y="${MT + 12}" class="rv-lbl">开局前</text>`);
    for (let k = 0; k <= 4; k++) {                      // y 轴刻度
      const p = lo + ((hi - lo) * k) / 4, y = Y(p);
      o.push(`<line x1="${ML}" x2="${W - MR}" y1="${y}" y2="${y}" class="rv-grid"/><text x="${W - MR + 4}" y="${y + 3}" class="rv-lbl">${p.toFixed(2)}</text>`);
    }
    for (let t = 1; t <= GameConfig.totalTurns; t += 1) {   // 回合刻度
      const i = turnStartIdx(t); if (i >= n) break;
      o.push(`<line x1="${ML + i * step}" x2="${ML + i * step}" y1="${MT}" y2="${MT + ph}" class="rv-tick"/>`);
      if (t % 2 === 1 || t === 1) o.push(`<text x="${ML + i * step + 2}" y="${H - 6}" class="rv-lbl">${t}</text>`);
    }
    o.push(`<text x="${W - MR + 4}" y="${H - 6}" class="rv-lbl">回合</text>`);

    for (let i = 0; i < n; i++) {                       // K 线
      const k = c[i], up = k.close >= k.open, cl = up ? 'rv-up' : 'rv-dn';
      const yt = Y(Math.max(k.open, k.close)), yb = Y(Math.min(k.open, k.close));
      o.push(`<line x1="${X(i)}" x2="${X(i)}" y1="${Y(k.high)}" y2="${Y(k.low)}" class="${cl}"/>` +
        `<rect x="${X(i) - bw / 2}" y="${yt}" width="${bw}" height="${Math.max(1, yb - yt)}" class="${cl} rv-body"/>`);
    }
    o.push(`<polyline class="rv-v" points="${v.map((p, i) => `${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')}"/>`);

    // 事件（只画影响本公司的）：垂直虚线 + 圆标，基=基本面 情=情绪
    const evs = state.eventLog.filter((e) => e.effects[id]);
    const stack = {};
    for (const e of evs) {
      const i = turnStartIdx(e.turn), x = X(i), k = (stack[e.turn] = (stack[e.turn] || 0) + 1) - 1;
      const f = e.kind === 'fundamental';
      const ef = e.effects[id];
      o.push(`<line x1="${x}" x2="${x}" y1="${MT}" y2="${MT + ph}" class="rv-ev ${f ? 'f' : 's'}"/>` +
        `<g class="rv-evm ${f ? 'f' : 's'}"><title>第${e.turn}回合 ${esc(e.headline)}\n真实价值 ${pct(Math.exp(ef.vLog) - 1)}，情绪冲击 ${ef.sShift >= 0 ? '+' : ''}${ef.sShift.toFixed(3)}</title>` +
        `<circle cx="${x}" cy="${MT - 8 + k * 0}" r="8"/><text x="${x}" y="${MT - 5}">${f ? '基' : '情'}</text></g>`);
    }
    // 研究估值：空心菱形，位于估值价位
    for (const r of state.researchLog.filter((r) => r.id === id)) {
      const i = turnStartIdx(r.turn), x = X(i), y = Y(r.estimate);
      o.push(`<g class="rv-est"><title>第${r.turn}回合研究（${r.points}点）：估值 ${fmt(r.estimate)}，当时真实价值 ${fmt(r.trueV)}（误差 ${pct(r.estimate / r.trueV - 1)}）</title>` +
        `<path d="M${x},${y - 6} L${x + 6},${y} L${x},${y + 6} L${x - 6},${y} Z"/></g>`);
    }
    // 买卖：买 ▲（红，价位下方），卖 ▼（绿，价位上方）
    for (const t of state.tradeLog.filter((t) => t.id === id)) {
      const i = turnStartIdx(t.turn), x = X(i), y = Y(t.price), buy = t.side === 'buy';
      const path = buy ? `M${x},${y + 3} L${x + 6},${y + 14} L${x - 6},${y + 14} Z` : `M${x},${y - 3} L${x + 6},${y - 14} L${x - 6},${y - 14} Z`;
      o.push(`<g class="rv-tr ${buy ? 'buy' : 'sell'}"><title>第${t.turn}回合${buy ? '买入' : '卖出'} ${t.shares}股 @${fmt(t.price)}</title><path d="${path}"/></g>`);
    }
    return `<svg viewBox="0 0 ${W} ${H}" class="rv-svg" role="img">${o.join('')}</svg>`;
  }

  function companySection(state, id) {
    const co = state.companies[id];
    const c = state.candles[id], v = state.vPath[id];
    const first = turnStartIdx(1), last = Math.min(c.length, turnStartIdx(state.result.turnsPlayed + 1));

    // 价格相对真实价值的最大偏离（游戏期间）
    let hiD = -Infinity, loD = Infinity, hiI = 0, loI = 0;
    for (let i = first; i < last; i++) {
      const d = c[i].close / v[i] - 1;
      if (d > hiD) { hiD = d; hiI = i; } if (d < loD) { loD = d; loI = i; }
    }
    const turnOf = (i) => Math.floor((i - first) / GameConfig.daysPerTurn) + 1;

    // 本股贡献盈亏 = 卖出所得 − 买入花费 − 手续费 + 期末持仓市值
    const trades = state.tradeLog.filter((t) => t.id === id);
    let pnl = 0;
    for (const t of trades) pnl += (t.side === 'buy' ? -1 : 1) * t.price * t.shares - t.fee;
    const pos = state.positions[id];
    if (pos) pnl += pos.shares * c[c.length - 1].close;

    const evs = state.eventLog.filter((e) => e.effects[id]);
    const evHtml = evs.length ? evs.map((e) => {
      const ef = e.effects[id];
      return `<tr><td>第 ${e.turn} 回合</td><td><span class="tag ${e.kind === 'fundamental' ? 'f' : 's'}">${e.kind === 'fundamental' ? '基本面' : '情绪'}</span></td>
        <td class="l">${esc(e.headline)}</td><td class="${cls(ef.vLog)}">${pct(Math.exp(ef.vLog) - 1)}</td><td class="${cls(ef.sShift)}">${ef.sShift >= 0 ? '+' : ''}${(ef.sShift * 100).toFixed(1)}%</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="muted l">本局没有影响这家公司的事件。</td></tr>';

    const rs = state.researchLog.filter((r) => r.id === id);
    const rsHtml = rs.length ? rs.map((r) => `<tr><td>第 ${r.turn} 回合</td><td>${r.points} 点</td><td>${fmt(r.estimate)}</td><td>${fmt(r.trueV)}</td>
      <td class="${Math.abs(r.estimate / r.trueV - 1) <= r.sigma ? '' : 'warn'}">${pct(r.estimate / r.trueV - 1)}</td></tr>`).join('')
      : '<tr><td colspan="5" class="muted l">你没有研究过这家公司。</td></tr>';

    const trHtml = trades.length ? trades.map((t) => `<tr><td>第 ${t.turn} 回合</td><td class="${t.side === 'buy' ? 'up' : 'down'}">${t.side === 'buy' ? '买入' : '卖出'}</td>
      <td>${t.shares} 股</td><td>@${fmt(t.price)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted l">没有交易。</td></tr>';

    return `<section class="rv-co">
      <h3>${co.name} <span class="muted">${co.industryName}</span>
        <span class="rv-params muted">年化增长 ${pct(co.growth, 1)} · 波动 ${(co.vol * 100).toFixed(1)}%/日 · 负债 ${(co.debt * 100).toFixed(0)}%</span>
        <span class="rv-pnl ${cls(pnl)}">本股贡献 ${pnl >= 0 ? '+' : ''}${fmt(pnl)}</span></h3>
      ${chartSvg(state, id)}
      <p class="rv-note">价格最高曾<b class="${cls(hiD)}">${hiD >= 0 ? '高于' : '低于'}</b>真实价值 ${(Math.abs(hiD) * 100).toFixed(1)}%（第 ${turnOf(hiI)} 回合），最低曾<b class="${cls(loD)}">${loD >= 0 ? '高于' : '低于'}</b>真实价值 ${(Math.abs(loD) * 100).toFixed(1)}%（第 ${turnOf(loI)} 回合）。蓝线是真实价值：价格围着它波动，偏离部分就是情绪。</p>
      <div class="rv-tables">
        <div><h4>影响这家公司的事件</h4><table><tr><th>回合</th><th>类型</th><th class="l">新闻</th><th>真实价值变化</th><th>情绪冲击</th></tr>${evHtml}</table></div>
        <div><h4>你的研究 vs 当时真实价值</h4><table><tr><th>回合</th><th>投入</th><th>估值</th><th>真实 V</th><th>误差</th></tr>${rsHtml}</table>
          <h4>你的交易</h4><table><tr><th>回合</th><th>方向</th><th>数量</th><th>成交价</th></tr>${trHtml}</table></div>
      </div></section>`;
  }

  function render(state) {
    const el = document.getElementById('review');
    el.innerHTML = `<div class="rv-wrap">
      <div class="rv-head"><h2>📊 复盘</h2><button data-action="review-close">← 返回结算</button></div>
      <div class="rv-legend">
        <span><i class="lg v"></i>真实价值 V（现在才揭晓）</span>
        <span><i class="lg up"></i>K线（红涨绿跌）</span>
        <span><b class="tag f">基</b> 基本面事件（V 变了）</span>
        <span><b class="tag s">情</b> 情绪事件（只有价格变，V 没变）</span>
        <span><i class="lg est"></i>你的研究估值</span>
        <span><b class="up">▲</b> 你的买入　<b class="down">▼</b> 你的卖出</span>
        <span class="muted">鼠标悬停标记可看详情</span>
      </div>
      ${Object.keys(state.companies).map((id) => companySection(state, id)).join('')}
    </div>`;
    el.hidden = false;
    el.scrollTop = 0;
  }

  function close() { document.getElementById('review').hidden = true; }

  return { render, close, chartSvg };
})();
