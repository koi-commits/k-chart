/* ============================================
   backtest.js — 策略回测引擎
   自定义买卖条件 → 历史数据回测 → 绩效报告
   ============================================ */

const BacktestEngine = (() => {

  // ── 技术指标（独立实现，不依赖 ChartManager）──
  function sma(data, n) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (i < n - 1) { result.push(null); continue; }
      let sum = 0;
      for (let j = i - n + 1; j <= i; j++) sum += data[j];
      result.push(sum / n);
    }
    return result;
  }

  function ema(data, n) {
    const result = [data[0]];
    const k = 2 / (n + 1);
    for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i - 1] * (1 - k));
    return result;
  }

  function calcRSI(closes, n) {
    const result = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < n) { result.push(null); continue; }
      let gain = 0, loss = 0;
      for (let j = i - n + 1; j <= i; j++) {
        const diff = closes[j] - closes[j - 1];
        if (diff > 0) gain += diff; else loss -= diff;
      }
      const avgGain = gain / n, avgLoss = loss / n;
      result.push(avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(1));
    }
    return result;
  }

  function calcMACD(closes) {
    const e12 = ema(closes, 12), e26 = ema(closes, 26);
    const macdLine = e12.map((v, i) => v - e26[i]);
    const signal = ema(macdLine, 9);
    const histogram = macdLine.map((v, i) => v - signal[i]);
    return { macdLine, signal, histogram };
  }

  function calcKDJ(highs, lows, closes, n, m1, m2) {
    const k = [], d = [], j = [];
    let pK = 50, pD = 50;
    for (let i = 0; i < closes.length; i++) {
      if (i < n - 1) { k.push(null); d.push(null); j.push(null); continue; }
      const st = i - n + 1;
      const hN = Math.max(...highs.slice(st, i + 1));
      const lN = Math.min(...lows.slice(st, i + 1));
      const rng = hN - lN;
      const rsv = rng === 0 ? 50 : ((closes[i] - lN) / rng) * 100;
      if (i === n - 1) { pK = rsv; pD = rsv; }
      else { pK = (rsv + (m1 - 1) * pK) / m1; pD = (pK + (m2 - 1) * pD) / m2; }
      k.push(+pK.toFixed(1));
      d.push(+pD.toFixed(1));
      const cJ = 3 * pK - 2 * pD;
      j.push(+Math.max(0, Math.min(100, cJ)).toFixed(1));
    }
    return { k, d, j };
  }

  // ── 条件评估 ──
  function evalCondition(cond, barIdx, closes, highs, lows, indicators) {
    switch (cond.type) {
      case 'indicator': {
        let val;
        switch (cond.indicator) {
          case 'rsi': val = indicators.rsi[barIdx]; break;
          case 'kdj_k': val = indicators.kdj.k[barIdx]; break;
          case 'kdj_d': val = indicators.kdj.d[barIdx]; break;
          case 'kdj_j': val = indicators.kdj.j[barIdx]; break;
          default: return false;
        }
        if (val == null) return false;
        switch (cond.operator) {
          case '>': return val > cond.value;
          case '<': return val < cond.value;
          case '>=': return val >= cond.value;
          case '<=': return val <= cond.value;
          case 'cross_above': return barIdx > 0 && indicators.prevRsi != null && indicators.prevRsi <= cond.value && val > cond.value;
          case 'cross_below': return barIdx > 0 && indicators.prevRsi != null && indicators.prevRsi >= cond.value && val < cond.value;
          default: return false;
        }
      }
      case 'price_vs_ma': {
        const ma = indicators.ma[cond.ma];
        if (!ma || ma[barIdx] == null) return false;
        const price = closes[barIdx];
        switch (cond.operator) {
          case '>': return price > ma[barIdx];
          case '<': return price < ma[barIdx];
          case 'cross_above': return barIdx > 0 && closes[barIdx - 1] <= ma[barIdx - 1] && price > ma[barIdx];
          case 'cross_below': return barIdx > 0 && closes[barIdx - 1] >= ma[barIdx - 1] && price < ma[barIdx];
          default: return false;
        }
      }
      case 'ma_cross': {
        const ma1 = indicators.ma[cond.ma1], ma2 = indicators.ma[cond.ma2];
        if (!ma1 || !ma2 || ma1[barIdx] == null || ma2[barIdx] == null) return false;
        if (barIdx < 1) return false;
        const prevDiff = ma1[barIdx - 1] - ma2[barIdx - 1];
        const currDiff = ma1[barIdx] - ma2[barIdx];
        if (cond.direction === 'up') return prevDiff <= 0 && currDiff > 0;
        if (cond.direction === 'down') return prevDiff >= 0 && currDiff < 0;
        return false;
      }
      case 'macd_cross': {
        const ml = indicators.macd.macdLine, sig = indicators.macd.signal;
        if (ml[barIdx] == null || sig[barIdx] == null || barIdx < 1) return false;
        const prevDiff = ml[barIdx - 1] - sig[barIdx - 1];
        const currDiff = ml[barIdx] - sig[barIdx];
        if (cond.direction === 'up') return prevDiff <= 0 && currDiff > 0;
        if (cond.direction === 'down') return prevDiff >= 0 && currDiff < 0;
        return false;
      }
      default: return false;
    }
  }

  function evalAll(conditions, barIdx, closes, highs, lows, indicators, logic) {
    if (!conditions || conditions.length === 0) return false;
    const results = conditions.map(c => evalCondition(c, barIdx, closes, highs, lows, indicators));
    if (logic === 'or' || logic === 'OR') return results.some(Boolean);
    return results.every(Boolean); // default: AND
  }

  // ── 回测运行 ──
  function run(symbol, config) {
    const sim = Simulator.get(symbol);
    const rawCandles = sim.getCandles();
    if (rawCandles.length < 50) return { error: '数据不足，至少需要50根K线' };

    const candles = rawCandles.map(c => ({
      ...c,
      time: c.time,
      open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume
    }));

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // 预计算所有指标
    const indicators = {
      ma: {
        5: sma(closes, 5),
        10: sma(closes, 10),
        20: sma(closes, 20),
      },
      rsi: calcRSI(closes, 14),
      macd: calcMACD(closes),
      kdj: calcKDJ(highs, lows, closes, 9, 3, 3),
      prevRsi: null,
    };

    const trades = [];
    let position = null;
    let capital = config.initialCapital || 100000;
    let equity = capital;
    const equityCurve = [];
    let peakEquity = capital;
    let maxDrawdown = 0;

    const startIdx = Math.max(50, config.warmupBars || 50); // 给指标足够的预热
    const positionSize = config.positionSize || 0.5;

    for (let i = startIdx; i < candles.length; i++) {
      // 更新 prevRsi（用于 cross 条件）
      indicators.prevRsi = i > 0 ? indicators.rsi[i - 1] : null;

      const candle = candles[i];

      if (position) {
        // 有持仓 → 检查退出条件
        let shouldExit = false;
        let exitReason = '';

        // 止盈止损
        const pnlPct = ((candle.close - position.entryPrice) / position.entryPrice) * (position.side === 'buy' ? 1 : -1);

        if (pnlPct <= -(config.stopLoss || 0.05) * 100) {
          shouldExit = true;
          exitReason = '止损';
        } else if (pnlPct >= (config.takeProfit || 0.15) * 100) {
          shouldExit = true;
          exitReason = '止盈';
        } else if (config.maxHoldBars && (i - position.entryBar) >= config.maxHoldBars) {
          shouldExit = true;
          exitReason = '持仓超时';
        } else if (evalAll(config.exitConditions, i, closes, highs, lows, indicators, config.exitLogic)) {
          shouldExit = true;
          exitReason = '条件触发';
        }

        if (shouldExit) {
          const exitPrice = candle.close;
          const holdingReturn = (exitPrice - position.entryPrice) / position.entryPrice;
          const pnl = position.side === 'buy' ? holdingReturn * position.invested : -holdingReturn * position.invested;
          const pnlAmount = pnl * position.invested;

          // 简化费用
          const fee = position.invested * 0.0005; // ~万5双向

          trades.push({
            symbol,
            entryBar: position.entryBar,
            exitBar: i,
            entryTime: candles[position.entryBar].time,
            exitTime: candle.time,
            side: position.side,
            entryPrice: position.entryPrice,
            exitPrice,
            shares: Math.floor(position.invested / position.entryPrice / 100) * 100,
            invested: position.invested,
            returnPct: +(holdingReturn * 100).toFixed(2),
            pnl: +(pnlAmount - fee).toFixed(2),
            pnlPct: +(pnl * 100).toFixed(2),
            exitReason,
            holdingBars: i - position.entryBar,
          });

          capital += pnlAmount - fee;
          position = null;
        }
      } else {
        // 无持仓 → 检查入场条件
        if (evalAll(config.entryConditions, i, closes, highs, lows, indicators, config.entryLogic)) {
          const investAmount = capital * positionSize;
          const entryPrice = candle.close;

          position = {
            symbol,
            side: config.side || 'buy',
            entryPrice,
            entryBar: i,
            invested: investAmount,
          };
        }
      }

      // 权益曲线
      equity = capital + (position ? (candle.close - position.entryPrice) / position.entryPrice * position.invested : 0);
      equityCurve.push({ time: candle.time, equity });
      if (equity > peakEquity) peakEquity = equity;
      const drawdown = (peakEquity - equity) / peakEquity;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // 如果还有持仓，按最后一根K线平仓
    if (position) {
      const lastCandle = candles[candles.length - 1];
      const holdingReturn = (lastCandle.close - position.entryPrice) / position.entryPrice;
      const pnl = holdingReturn * position.invested;
      const fee = position.invested * 0.0005;
      capital += pnl - fee;

      trades.push({
        symbol,
        entryBar: position.entryBar,
        exitBar: candles.length - 1,
        entryTime: candles[position.entryBar].time,
        exitTime: lastCandle.time,
        side: position.side,
        entryPrice: position.entryPrice,
        exitPrice: lastCandle.close,
        shares: Math.floor(position.invested / position.entryPrice / 100) * 100,
        invested: position.invested,
        returnPct: +(holdingReturn * 100).toFixed(2),
        pnl: +(pnl - fee).toFixed(2),
        pnlPct: +(pnl * 100).toFixed(2),
        exitReason: '回测结束',
        holdingBars: candles.length - 1 - position.entryBar,
      });
      position = null;
    }

    // ── 绩效计算 ──
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl < 0);
    const totalReturn = ((capital - config.initialCapital) / config.initialCapital) * 100;
    const tradingDays = (candles.length - startIdx);
    const annualizedReturn = totalReturn * (252 / Math.max(1, tradingDays));
    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
    const profitFactor = losses.length > 0 && avgLoss > 0
      ? (wins.reduce((s, t) => s + t.pnl, 0)) / Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
      : (wins.length > 0 ? Infinity : 0);
    const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.pnl)) : 0;
    const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.pnl)) : 0;

    // Sharpe Ratio
    const returns = [];
    for (let i = 1; i < equityCurve.length; i++) {
      if (equityCurve[i - 1].equity > 0) {
        returns.push((equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity);
      }
    }
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const returnStd = returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length)
      : 0;
    const sharpeRatio = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(252) : 0;

    return {
      config,
      symbol,
      stats: {
        initialCapital: config.initialCapital,
        finalCapital: +capital.toFixed(2),
        totalReturn: +totalReturn.toFixed(2),
        annualizedReturn: +annualizedReturn.toFixed(2),
        maxDrawdown: +(maxDrawdown * 100).toFixed(2),
        sharpeRatio: +sharpeRatio.toFixed(2),
        winRate: +winRate.toFixed(1),
        profitFactor: profitFactor === Infinity ? 999 : +profitFactor.toFixed(2),
        totalTrades: trades.length,
        avgWin: +avgWin.toFixed(2),
        avgLoss: +avgLoss.toFixed(2),
        largestWin: +largestWin.toFixed(2),
        largestLoss: +largestLoss.toFixed(2),
        avgHoldingBars: trades.length > 0 ? +(trades.reduce((s, t) => s + t.holdingBars, 0) / trades.length).toFixed(0) : 0,
      },
      trades,
      equityCurve,
      startBar: startIdx,
      endBar: candles.length - 1,
    };
  }

  // ── 预设策略模板 ──
  const PRESETS = {
    'rsi_oversold': {
      name: 'RSI超卖反弹',
      description: 'RSI<30超卖时买入，RSI>70超买时卖出',
      entryConditions: [{ type: 'indicator', indicator: 'rsi', operator: '<', value: 30 }],
      exitConditions: [{ type: 'indicator', indicator: 'rsi', operator: '>', value: 70 }],
      entryLogic: 'AND', exitLogic: 'AND',
      side: 'buy', positionSize: 0.5, stopLoss: 0.05, takeProfit: 0.15, maxHoldBars: 40,
    },
    'ma_golden_cross': {
      name: '均线金叉',
      description: 'MA5上穿MA20时买入，MA5下穿MA20时卖出',
      entryConditions: [{ type: 'ma_cross', ma1: 5, ma2: 20, direction: 'up' }],
      exitConditions: [{ type: 'ma_cross', ma1: 5, ma2: 20, direction: 'down' }],
      entryLogic: 'AND', exitLogic: 'AND',
      side: 'buy', positionSize: 0.5, stopLoss: 0.08, takeProfit: 0.20, maxHoldBars: 60,
    },
    'macd_signal': {
      name: 'MACD金叉死叉',
      description: 'MACD上穿信号线买入，下穿卖出',
      entryConditions: [{ type: 'macd_cross', direction: 'up' }],
      exitConditions: [{ type: 'macd_cross', direction: 'down' }],
      entryLogic: 'AND', exitLogic: 'AND',
      side: 'buy', positionSize: 0.5, stopLoss: 0.05, takeProfit: 0.15, maxHoldBars: 40,
    },
    'kdj_oversold': {
      name: 'KDJ超卖反转',
      description: 'K值<20超卖时买入，K值>80超买时卖出',
      entryConditions: [{ type: 'indicator', indicator: 'kdj_k', operator: '<', value: 20 }],
      exitConditions: [{ type: 'indicator', indicator: 'kdj_k', operator: '>', value: 80 }],
      entryLogic: 'AND', exitLogic: 'AND',
      side: 'buy', positionSize: 0.5, stopLoss: 0.05, takeProfit: 0.12, maxHoldBars: 30,
    },
    'trend_follow': {
      name: '趋势跟随',
      description: '价格>MA20且RSI>50买入，价格<MA20卖出',
      entryConditions: [
        { type: 'price_vs_ma', ma: 20, operator: '>' },
        { type: 'indicator', indicator: 'rsi', operator: '>', value: 50 },
      ],
      exitConditions: [{ type: 'price_vs_ma', ma: 20, operator: '<' }],
      entryLogic: 'AND', exitLogic: 'AND',
      side: 'buy', positionSize: 0.5, stopLoss: 0.06, takeProfit: 0.20, maxHoldBars: 80,
    },
  };

  // ── 状态 ──
  let lastResult = null;

  // ── 公开API ──
  return {
    run,
    PRESETS,
    getLastResult: () => lastResult,
    runAndSave(symbol, config) {
      lastResult = run(symbol, config);
      return lastResult;
    },
    // 技术指标暴露（供其他模块使用）
    sma, ema, calcRSI, calcMACD, calcKDJ,
  };
})();
