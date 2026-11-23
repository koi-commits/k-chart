/* ui/replay.js — 结束回合后，本周 5 根日K逐根快速回放（总时长约 2 秒） */
const GameReplay = (() => {
  const TOTAL_MS = 2000;

  /** 图表需要毫秒时间戳（chart.js 内部会 /1000） */
  function toChart(candles) {
    return candles.map((c) => ({ time: c.time * 1000, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
  }

  /** 买入 ▲ / 卖出 ▼ 标记（画在成交当天的K线上）+ 持仓成本线；只显示已经"过去"的交易 */
  function tradeOverlay(state, id, upto) {
    const c = state.candles[id], n = upto == null ? c.length : upto;
    const markers = state.tradeLog.filter((t) => t.id === id && t.day < n).map((t) => (t.side === 'buy'
      ? { time: c[t.day].time, position: 'belowBar', color: '#ff5252', shape: 'arrowUp', text: '买' + t.shares }
      : { time: c[t.day].time, position: 'aboveBar', color: '#66bb6a', shape: 'arrowDown', text: '卖' + t.shares }));
    markers.sort((a, b) => a.time - b.time);
    const pos = state.positions[id];
    return { markers, cost: pos && pos.shares > 0 ? Math.round(pos.avgCost * 100) / 100 : 0 };
  }

  function showChart(state, id, upto) {
    const c = state.candles[id];
    ChartManager.updateData(toChart(upto == null ? c : c.slice(0, upto)), 60);
    const o = tradeOverlay(state, id, upto);
    ChartManager.setTradeOverlay(o.markers, o.cost);
  }

  /**
   * @param state  回合结束后的新 state（candles 已含本周 5 根）
   * @param ui     { selected }
   * @param frame  (upto) => void 每帧重绘价格相关 UI
   * @param done   () => void
   */
  function play(state, ui, frame, done) {
    const days = GameConfig.daysPerTurn;
    const len = state.candles[ui.selected].length;
    let k = 0;
    (function step() {
      k++;
      const upto = len - days + k;
      showChart(state, ui.selected, upto);
      frame(upto);
      if (k < days) setTimeout(step, TOTAL_MS / days);
      else done();
    })();
  }

  return { play, showChart, toChart, tradeOverlay };
})();
