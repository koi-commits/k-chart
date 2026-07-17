/* analytics.js — Performance Analytics Dashboard */
const Analytics = (() => {
  var currentYear = new Date().getFullYear();
  var currentMonth = new Date().getMonth();

  function pairTrades() {
    var trades = Trader.getTrades(99999);
    var allPnLs = [];
    var buyStack = [];

    for (var i = 0; i < trades.length; i++) {
      var t = trades[i];
      if (!t || t.shares <= 0) continue;
      if (t.side === 'buy') {
        buyStack.push({ price: t.price, shares: t.shares, time: t.time, symbol: t.symbol });
      } else {
        var remainingSell = t.shares;
        while (remainingSell > 0 && buyStack.length > 0) {
          var buy = buyStack.shift();
          var matchedShares = Math.min(buy.shares, remainingSell);
          var buyVal = buy.price * matchedShares;
          var sellVal = t.price * matchedShares;
          var feeBuy = Trader.calcFee('buy', buy.price, matchedShares).total;
          var feeSell = Trader.calcFee('sell', t.price, matchedShares).total;
          allPnLs.push(sellVal - buyVal - feeBuy - feeSell);
          remainingSell -= matchedShares;
          if (buy.shares > matchedShares) {
            buyStack.unshift({ price: buy.price, shares: buy.shares - matchedShares, time: buy.time, symbol: buy.symbol });
          }
        }
      }
    }
    return allPnLs;
  }

  function getStats() {
    var allPnLs = pairTrades();

    var totalPnL = allPnLs.reduce(function(s, v) { return s + v; }, 0);
    var wins = allPnLs.filter(function(v) { return v > 0; });
    var losses = allPnLs.filter(function(v) { return v < 0; });
    var winCount = wins.length;
    var lossCount = losses.length;
    var closedCount = allPnLs.length;
    var winRate = closedCount > 0 ? (winCount / closedCount) * 100 : 0;

    var totalWin = wins.reduce(function(s, v) { return s + v; }, 0);
    var totalLoss = Math.abs(losses.reduce(function(s, v) { return s + v; }, 0));
    var profitFactor = totalLoss > 0 ? totalWin / totalLoss : (totalWin > 0 ? 999 : 0);

    var avgWin = winCount > 0 ? totalWin / winCount : 0;
    var avgLoss = lossCount > 0 ? totalLoss / lossCount : 0;

    var largestWin = winCount > 0 ? Math.max.apply(null, wins) : 0;
    var largestLoss = lossCount > 0 ? Math.min.apply(null, losses) : 0;

    var winLossRatio = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? 999 : 0);

    // Consecutive wins/losses
    var maxConW = 0, maxConL = 0, curW = 0, curL = 0;
    for (var j = 0; j < allPnLs.length; j++) {
      if (allPnLs[j] > 0) { curW++; curL = 0; if (curW > maxConW) maxConW = curW; }
      else { curL++; curW = 0; if (curL > maxConL) maxConL = curL; }
    }

    // Sharpe ratio
    var sharpe = 0;
    if (allPnLs.length > 1) {
      var mean = totalPnL / allPnLs.length;
      var sqDiffs = allPnLs.map(function(v) { return Math.pow(v - mean, 2); });
      var variance = sqDiffs.reduce(function(s, v) { return s + v; }, 0) / sqDiffs.length;
      var std = Math.sqrt(variance);
      sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
    }

    // Max drawdown
    var maxDD = 0;
    var peak = Trader.getSummary().initialCapital;
    var equity = peak;
    for (var k = 0; k < allPnLs.length; k++) {
      equity += allPnLs[k];
      if (equity > peak) peak = equity;
      var dd = peak > 0 ? (peak - equity) / peak * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    }

    return {
      totalPnL: totalPnL,
      winRate: winRate,
      profitFactor: profitFactor,
      maxDrawdown: maxDD,
      avgWin: avgWin,
      avgLoss: avgLoss,
      winLossRatio: winLossRatio,
      largestWin: largestWin,
      largestLoss: largestLoss,
      maxConsecWins: maxConW,
      maxConsecLosses: maxConL,
      sharpeRatio: sharpe,
      totalTrades: closedCount,
      winCount: winCount,
      lossCount: lossCount
    };
  }

  function renderStats(container) {
    if (!container) return;
    var s = getStats();
    var items = [
      { label: '总盈亏', value: '¥' + s.totalPnL.toLocaleString(undefined, {minimumFractionDigits:2}), cls: s.totalPnL >= 0 ? 'up' : 'down' },
      { label: '胜率', value: s.winRate.toFixed(1) + '%', cls: '' },
      { label: '盈亏比', value: s.profitFactor >= 999 ? '∞' : s.profitFactor.toFixed(2), cls: '' },
      { label: '总交易', value: '' + s.totalTrades, cls: '' },
      { label: '盈利次数', value: '' + s.winCount, cls: 'up' },
      { label: '亏损次数', value: '' + s.lossCount, cls: 'down' },
      { label: '平均盈利', value: '¥' + s.avgWin.toFixed(2), cls: 'up' },
      { label: '平均亏损', value: '¥' + Math.abs(s.avgLoss).toFixed(2), cls: 'down' },
      { label: '最大盈利', value: '¥' + s.largestWin.toFixed(2), cls: 'up' },
      { label: '最大亏损', value: '¥' + Math.abs(s.largestLoss).toFixed(2), cls: 'down' },
      { label: '最大回撤', value: s.maxDrawdown.toFixed(2) + '%', cls: 'down' },
      { label: '夏普比率', value: s.sharpeRatio.toFixed(3), cls: s.sharpeRatio > 0 ? 'up' : 'down' },
      { label: '胜率(W/L)', value: s.winLossRatio >= 999 ? '∞' : s.winLossRatio.toFixed(2), cls: '' },
      { label: '连胜/连败', value: s.maxConsecWins + '/' + s.maxConsecLosses, cls: '' }
    ];
    container.innerHTML = '<div class="analytics-grid">' + items.map(function(item) {
      return '<div class="stat-card"><div class="stat-label">' + item.label + '</div><div class="stat-value ' + item.cls + '">' + item.value + '</div></div>';
    }).join('') + '</div>';
  }

  function renderHeatmap(container) {
    if (!container) return;
    // Compute daily P&L from trades
    var dayData = {};
    var trades = Trader.getTrades(99999);
    var buyStack2 = [];
    for (var i = 0; i < trades.length; i++) {
      var t = trades[i];
      if (!t || t.shares <= 0) continue;
      var d = new Date(t.time);
      var dayKey = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
      if (!dayData[dayKey]) dayData[dayKey] = 0;

      if (t.side === 'buy') {
        buyStack2.push({ price: t.price, shares: t.shares, time: t.time });
      } else {
        var remainingSell = t.shares;
        var dayPnL = 0;
        while (remainingSell > 0 && buyStack2.length > 0) {
          var buy = buyStack2.shift();
          var matched = Math.min(buy.shares, remainingSell);
          var feeBuy = Trader.calcFee('buy', buy.price, matched).total;
          var feeSell = Trader.calcFee('sell', t.price, matched).total;
          dayPnL += (t.price - buy.price) * matched - feeBuy - feeSell;
          remainingSell -= matched;
          if (buy.shares > matched) {
            buyStack2.unshift({ price: buy.price, shares: buy.shares - matched, time: buy.time });
          }
        }
        dayData[dayKey] += dayPnL;
      }
    }

    var year = currentYear;
    var month = currentMonth;
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var firstDay = new Date(year, month, 0).getDay();
    var monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

    // Find max abs P&L for intensity scaling
    var maxAbsPnL = 1;
    for (var d = 1; d <= daysInMonth; d++) {
      var dk = year + '-' + pad2(month + 1) + '-' + pad2(d);
      var pnl = dayData[dk] || 0;
      if (Math.abs(pnl) > maxAbsPnL) maxAbsPnL = Math.abs(pnl);
    }

    var today = new Date();
    var html = '<div class="heatmap-header">';
    html += '<button class="heatmap-nav" onclick="Analytics.prevMonth()">◀</button>';
    html += '<span class="heatmap-title">' + year + '年 ' + monthNames[month] + '</span>';
    html += '<button class="heatmap-nav" onclick="Analytics.nextMonth()">▶</button>';
    html += '</div>';

    html += '<div class="heatmap-grid">';
    var dayLabels = ['日','一','二','三','四','五','六'];
    html += '<div class="heatmap-day-labels">' + dayLabels.map(function(dl) { return '<span class="heatmap-day-label">' + dl + '</span>'; }).join('') + '</div>';
    html += '<div class="heatmap-cells">';

    for (var f = 0; f < firstDay; f++) {
      html += '<div class="heatmap-cell empty"></div>';
    }

    for (var d2 = 1; d2 <= daysInMonth; d2++) {
      var dk2 = year + '-' + pad2(month + 1) + '-' + pad2(d2);
      var pnl = dayData[dk2] || 0;
      var intensity = maxAbsPnL > 0 ? Math.abs(pnl) / maxAbsPnL : 0;
      var isPositive = pnl >= 0;
      var isToday = d2 === today.getDate() && month === today.getMonth() && year === today.getFullYear();
      var bg = pnl === 0 ? 'transparent' : (isPositive ? 'rgba(102,187,106,' + (0.2 + intensity * 0.7) + ')' : 'rgba(255,82,82,' + (0.2 + intensity * 0.7) + ')');
      html += '<div class="heatmap-cell' + (isToday ? ' today' : '') + (pnl !== 0 ? ' has-data' : '') + '" style="background:' + bg + '" title="' + dk2 + ': ¥' + pnl.toFixed(0) + '">';
      html += '<span class="heatmap-day-num">' + d2 + '</span>';
      html += '</div>';
    }

    html += '</div></div>';
    container.innerHTML = html;
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function prevMonth() {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    refresh();
  }

  function nextMonth() {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    refresh();
  }

  function refresh() {
    var sc = document.getElementById('analyticsStats');
    var hc = document.getElementById('analyticsHeatmap');
    if (sc) renderStats(sc);
    if (hc) renderHeatmap(hc);
  }

  return {
    getStats: getStats,
    renderStats: renderStats,
    renderHeatmap: renderHeatmap,
    prevMonth: prevMonth,
    nextMonth: nextMonth,
    refresh: refresh
  };
})();
