/* ui/replay.js — 结束回合后，本周 5 根日K逐根快速回放（总时长约 2 秒） */
const GameReplay = (() => {
  const TOTAL_MS = 2000;

  /** 图表需要毫秒时间戳（chart.js 内部会 /1000） */
  function toChart(candles) {
    return candles.map((c) => ({ time: c.time * 1000, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
  }

  function showChart(state, id, upto) {
    const c = state.candles[id];
    ChartManager.updateData(toChart(upto == null ? c : c.slice(0, upto)), 60);
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

  return { play, showChart, toChart };
})();
