/* ============================================
   multiview.js — 多周期分屏视图
   将主图拆分为2个不同周期的K线面板，同步十字光标
   使用 LightweightCharts v4 UMD
   ============================================ */

const MultiView = (() => {

  // ────── 状态 ──────
  var layout = 'single';       // 'single' | '2h' | '2v'
  var originalChartEl = null;
  var originalParent = null;
  var container = null;        // 分屏容器 div
  var pane1El = null, pane2El = null;
  var chart1 = null, chart2 = null;
  var series1 = null, series2 = null;     // candlestick series
  var ma1_5 = null, ma1_10 = null;        // pane1 MAs
  var ma2_5 = null, ma2_10 = null;        // pane2 MAs
  var period1 = '15m', period2 = '1h';
  var sourceCandles = [];       // 原始1分钟数据
  var crosshairSyncing = false; // 防递归标志
  var initialized = false;

  // ────── 主题颜色 ──────
  function isDark() {
    return document.documentElement.dataset.theme !== 'light';
  }

  function chartColors() {
    var d = isDark();
    return {
      bg: d ? '#0d0d0d' : '#fff',
      txt: d ? '#999' : '#666',
      grid: d ? '#1a1a1a' : '#f0f0f0',
      bd: d ? '#2a2a2a' : '#e0e0e0',
      up: d ? '#ff5252' : '#e53935',
      dn: d ? '#66bb6a' : '#2e7d32',
      upBg: d ? 'rgba(255,82,82,0.2)' : 'rgba(229,57,53,0.2)',
      dnBg: d ? 'rgba(102,187,106,0.2)' : 'rgba(46,125,50,0.2)',
      ma5: d ? '#f5a623' : '#e67e22',
      ma10: d ? '#42a5f5' : '#1976d2',
      x: d ? '#555' : '#bdbdbd'
    };
  }

  // ────── LightweightCharts 图表创建 ──────
  function createChart(el, timeVisible) {
    var co = chartColors();
    return LightweightCharts.createChart(el, {
      layout: { background: { color: co.bg }, textColor: co.txt },
      grid: {
        vertLines: { color: co.grid },
        horzLines: { color: co.grid }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: co.x, labelBackgroundColor: co.x },
        horzLine: { color: co.x, labelBackgroundColor: co.x }
      },
      rightPriceScale: { borderColor: co.bd },
      timeScale: { borderColor: co.bd, timeVisible: !!timeVisible, secondsVisible: false },
      height: 200  // 默认高度，init时会调整
    });
  }

  // ────── 工具函数：SMA ──────
  function sma(data, n) {
    var result = [];
    for (var i = 0; i < data.length; i++) {
      if (i < n - 1) { result.push(null); continue; }
      var sum = 0;
      for (var j = i - n + 1; j <= i; j++) sum += data[j];
      result.push(sum / n);
    }
    return result;
  }

  // ────── 周期聚合：1分钟 → 目标周期 ──────
  function aggregateCandles(source, periodMs) {
    if (!source || source.length === 0) return [];
    var buckets = {};
    for (var i = 0; i < source.length; i++) {
      var c = source[i];
      var bucketTime = Math.floor(c.time / periodMs) * periodMs;
      if (!buckets[bucketTime]) buckets[bucketTime] = [];
      buckets[bucketTime].push(c);
    }
    var result = [];
    for (var bt in buckets) {
      if (!buckets.hasOwnProperty(bt)) continue;
      var bucket = buckets[bt];
      result.push({
        time: parseInt(bt),
        open: bucket[0].open,
        high: Math.max.apply(null, bucket.map(function(b) { return b.high; })),
        low: Math.min.apply(null, bucket.map(function(b) { return b.low; })),
        close: bucket[bucket.length - 1].close,
        volume: bucket.reduce(function(s, b) { return s + b.volume; }, 0)
      });
    }
    result.sort(function(a, b) { return a.time - b.time; });
    return result;
  }

  // ────── 转换OHLC为LC格式 ──────
  function toLCFormat(candles) {
    return candles.map(function(c) {
      return {
        time: Math.floor(c.time / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      };
    });
  }

  // ────── 计算MA数据 ──────
  function calcMA(candles, period) {
    var lcData = toLCFormat(candles);
    var closes = lcData.map(function(c) { return c.close; });
    var maValues = sma(closes, period);
    var result = [];
    for (var i = 0; i < lcData.length; i++) {
      if (maValues[i] !== null) {
        result.push({ time: lcData[i].time, value: +maValues[i].toFixed(2) });
      }
    }
    return result;
  }

  // ────── 更新单个面板的图表数据 ──────
  function updatePaneData(paneIndex) {
    var period = paneIndex === 0 ? period1 : period2;
    var chart = paneIndex === 0 ? chart1 : chart2;
    var candleSeries = paneIndex === 0 ? series1 : series2;
    var ma5Series = paneIndex === 0 ? ma1_5 : ma2_5;
    var ma10Series = paneIndex === 0 ? ma1_10 : ma2_10;

    var periodMs = Simulator.PERIOD_MS[period] || 900000;
    var aggregated = aggregateCandles(sourceCandles, periodMs);
    var ohlc = toLCFormat(aggregated);

    // 设置K线数据
    candleSeries.setData(ohlc);

    // 计算并设置MA
    var ma5Data = calcMA(aggregated, 5);
    var ma10Data = calcMA(aggregated, 10);

    ma5Series.setData(ma5Data);
    ma10Series.setData(ma10Data);

    // 自适应显示范围
    try { chart.timeScale().fitContent(); } catch(e) {}
  }

  // ────── 更新两个面板的图表数据 ──────
  function updateBothPanes() {
    if (layout === 'single') return;
    updatePaneData(0);
    updatePaneData(1);
  }

  // ────── 设置十字光标同步 ──────
  function setupCrosshairSync() {
    if (!chart1 || !chart2) return;

    // 面板1 → 面板2
    chart1.subscribeCrosshairMove(function(param) {
      if (crosshairSyncing) return;
      if (!param.point || !param.time) return;
      crosshairSyncing = true;
      try {
        chart2.timeScale().scrollToPosition(
          chart1.timeScale().scrollPosition(), false
        );
      } catch(e) {}
      // 延迟重置标志，避免同一帧内的递归
      setTimeout(function() { crosshairSyncing = false; }, 50);
    });

    // 面板2 → 面板1
    chart2.subscribeCrosshairMove(function(param) {
      if (crosshairSyncing) return;
      if (!param.point || !param.time) return;
      crosshairSyncing = true;
      try {
        chart1.timeScale().scrollToPosition(
          chart2.timeScale().scrollPosition(), false
        );
      } catch(e) {}
      setTimeout(function() { crosshairSyncing = false; }, 50);
    });

    // 同步可见逻辑范围（缩放/滚动同步）
    chart1.timeScale().subscribeVisibleLogicalRangeChange(function(range) {
      if (crosshairSyncing) return;
      if (!range) return;
      crosshairSyncing = true;
      try {
        chart2.timeScale().setVisibleLogicalRange(range);
      } catch(e) {}
      setTimeout(function() { crosshairSyncing = false; }, 50);
    });

    chart2.timeScale().subscribeVisibleLogicalRangeChange(function(range) {
      if (crosshairSyncing) return;
      if (!range) return;
      crosshairSyncing = true;
      try {
        chart1.timeScale().setVisibleLogicalRange(range);
      } catch(e) {}
      setTimeout(function() { crosshairSyncing = false; }, 50);
    });
  }

  // ────── 创建周期选择按钮 ──────
  function createPeriodButtons(paneIndex) {
    var div = document.createElement('div');
    div.className = 'mv-period-buttons';
    div.style.cssText = 'display:flex;gap:2px;padding:2px 4px;flex-shrink:0;';

    var periods = ['1m', '5m', '15m', '1h', '1d'];
    var labels = { '1m': '1分', '5m': '5分', '15m': '15分', '1h': '1时', '1d': '日线' };
    var current = paneIndex === 0 ? period1 : period2;

    for (var i = 0; i < periods.length; i++) {
      var p = periods[i];
      var btn = document.createElement('button');
      btn.textContent = labels[p] || p;
      btn.dataset.period = p;
      btn.dataset.pane = String(paneIndex);
      btn.style.cssText =
        'padding:1px 4px;font-size:9px;border:1px solid ' + (isDark() ? '#3a3a3a' : '#e0e0e0') + ';' +
        'border-radius:3px;cursor:pointer;background:' + (p === current ?
          (isDark() ? '#333' : '#e0e0e0') : (isDark() ? '#1a1a1a' : '#fafafa')) + ';' +
        'color:' + (isDark() ? '#ccc' : '#333') + ';' +
        'font-family:var(--font-stack, sans-serif);outline:none;';

      // 使用 IIFE 捕获 p 和 paneIndex
      (function(period, pIdx) {
        btn.addEventListener('click', function() {
          MultiView.setPeriod(pIdx, period);
        });
      })(p, paneIndex);

      div.appendChild(btn);
    }
    return div;
  }

  // ────── 构建分屏 DOM ──────
  function buildSplitView() {
    // 获取原始图表元素的父容器
    var chartArea = document.querySelector('.chart-area');
    if (!chartArea) return;

    // 创建分屏容器
    container = document.createElement('div');
    container.id = 'multiViewContainer';
    container.style.cssText =
      'display:flex;flex-direction:' + (layout === '2v' ? 'row' : 'column') + ';' +
      'flex:1;gap:2px;overflow:hidden;';

    // 面板1
    var wrap1 = document.createElement('div');
    wrap1.className = 'mv-pane-wrap';
    wrap1.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
    var btns1 = createPeriodButtons(0);
    wrap1.appendChild(btns1);

    pane1El = document.createElement('div');
    pane1El.className = 'mv-pane-chart';
    pane1El.style.cssText = 'flex:1;overflow:hidden;';
    wrap1.appendChild(pane1El);

    // 面板2
    var wrap2 = document.createElement('div');
    wrap2.className = 'mv-pane-wrap';
    wrap2.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;min-height:0;';
    var btns2 = createPeriodButtons(1);
    wrap2.appendChild(btns2);

    pane2El = document.createElement('div');
    pane2El.className = 'mv-pane-chart';
    pane2El.style.cssText = 'flex:1;overflow:hidden;';
    wrap2.appendChild(pane2El);

    container.appendChild(wrap1);
    container.appendChild(wrap2);

    // 找到主图容器在 chart-area 中的位置，插入分屏容器
    if (originalChartEl) {
      originalChartEl.style.display = 'none';
    }

    // 插入到第一个子元素（价格栏）之后、volume chart 容器之前
    // 策略：找到 #mainChart 并替换
    var mainChartEl = document.getElementById('mainChart');
    if (mainChartEl && mainChartEl.parentNode) {
      mainChartEl.parentNode.insertBefore(container, mainChartEl);
    }
  }

  // ────── 销毁分屏 DOM ──────
  function destroySplitView() {
    // 清理图表
    if (chart1) { try { chart1.remove(); } catch(e) {} chart1 = null; }
    if (chart2) { try { chart2.remove(); } catch(e) {} chart2 = null; }
    series1 = null; series2 = null;
    ma1_5 = null; ma1_10 = null;
    ma2_5 = null; ma2_10 = null;

    // 移除容器
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
    pane1El = null;
    pane2El = null;

    // 恢复原始图表
    var mainChartEl = document.getElementById('mainChart');
    if (mainChartEl) {
      mainChartEl.style.display = '';
      // 触发 resize 让图表重新计算尺寸
      setTimeout(function() {
        if (typeof ChartManager !== 'undefined' && ChartManager.resize) {
          ChartManager.resize();
        }
      }, 100);
    }
  }

  // ────── Public API ──────

  /**
   * 初始化分屏视图
   * @param {string} mainChartContainerId - 主图容器的 ID，如 'mainChart'
   */
  function init(mainChartContainerId) {
    try {
      originalChartEl = document.getElementById(mainChartContainerId || 'mainChart');
      if (!originalChartEl) {
        console.warn('[MultiView] 找不到主图容器: ' + mainChartContainerId);
        return;
      }
      originalParent = originalChartEl.parentNode;

      // 从 localStorage 恢复布局
      var saved = localStorage.getItem('kline_multiview');
      if (saved) {
        try {
          var cfg = JSON.parse(saved);
          if (cfg.layout && cfg.layout !== 'single') {
            layout = cfg.layout;
            period1 = cfg.period1 || '15m';
            period2 = cfg.period2 || '1h';
          }
        } catch(e) {}
      }

      initialized = true;
    } catch(e) {
      console.warn('[MultiView] init error: ' + e.message);
    }
  }

  /**
   * 设置分屏布局
   * @param {string} newLayout - 'single' | '2h' | '2v'
   */
  function setLayout(newLayout) {
    try {
      if (!initialized) return;

      // 如果已经是目标布局，跳过
      if (layout === newLayout) return;

      // 先销毁旧的
      if (layout !== 'single') {
        destroySplitView();
      }

      layout = newLayout;

      if (layout === 'single') {
        // 恢复原始单视图
        saveLayout();
        return;
      }

      // 构建分屏
      buildSplitView();

      // 等待 DOM 渲染后再创建图表
      setTimeout(function() {
        if (!container) return;

        // 创建图表
        chart1 = createChart(pane1El, true);
        chart2 = createChart(pane2El, true);

        var co = chartColors();
        series1 = chart1.addCandlestickSeries({
          upColor: co.up, downColor: co.dn,
          borderUpColor: co.up, borderDownColor: co.dn,
          wickUpColor: co.up, wickDownColor: co.dn
        });
        series2 = chart2.addCandlestickSeries({
          upColor: co.up, downColor: co.dn,
          borderUpColor: co.up, borderDownColor: co.dn,
          wickUpColor: co.up, wickDownColor: co.dn
        });

        ma1_5 = chart1.addLineSeries({ color: co.ma5, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        ma1_10 = chart1.addLineSeries({ color: co.ma10, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        ma2_5 = chart2.addLineSeries({ color: co.ma5, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        ma2_10 = chart2.addLineSeries({ color: co.ma10, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

        // 更新数据
        updateBothPanes();

        // 设置十字光标同步
        setupCrosshairSync();

        // 调整尺寸
        resizeCharts();
      }, 50);

      saveLayout();
    } catch(e) {
      console.warn('[MultiView] setLayout error: ' + e.message);
    }
  }

  /**
   * 获取当前布局
   * @returns {string} 'single' | '2h' | '2v'
   */
  function getLayout() {
    return layout;
  }

  /**
   * 当有新K线数据时调用，更新源数据并刷新图表
   * @param {Array} candles - 1分钟原始K线数组
   */
  function updateCandles(candles) {
    try {
      sourceCandles = candles || [];
      if (layout !== 'single') {
        updateBothPanes();
      }
    } catch(e) {
      console.warn('[MultiView] updateCandles error: ' + e.message);
    }
  }

  /**
   * 设置指定面板的K线周期
   * @param {number} paneIndex - 0 或 1
   * @param {string} period - '1m' | '5m' | '15m' | '1h' | '1d' | '1w'
   */
  function setPeriod(paneIndex, period) {
    try {
      if (!Simulator.PERIOD_MS[period]) {
        console.warn('[MultiView] 不支持的周期: ' + period);
        return;
      }
      if (paneIndex === 0) {
        period1 = period;
      } else {
        period2 = period;
      }

      // 更新按钮样式
      var allBtns = document.querySelectorAll('.mv-period-buttons button');
      for (var i = 0; i < allBtns.length; i++) {
        var btn = allBtns[i];
        var btnPane = parseInt(btn.dataset.pane);
        if (btnPane === paneIndex) {
          btn.style.background = btn.dataset.period === period ?
            (isDark() ? '#333' : '#e0e0e0') :
            (isDark() ? '#1a1a1a' : '#fafafa');
        }
      }

      // 重新计算并更新对应面板
      if (layout !== 'single') {
        updatePaneData(paneIndex);
      }

      saveLayout();
    } catch(e) {
      console.warn('[MultiView] setPeriod error: ' + e.message);
    }
  }

  /**
   * 销毁分屏，恢复到单视图
   */
  function destroy() {
    try {
      if (layout !== 'single') {
        destroySplitView();
      }
      layout = 'single';
      sourceCandles = [];
      initialized = false;
      localStorage.removeItem('kline_multiview');
    } catch(e) {
      console.warn('[MultiView] destroy error: ' + e.message);
    }
  }

  /**
   * 调整分屏图表尺寸
   */
  function resizeCharts() {
    try {
      if (layout === 'single') return;
      if (chart1 && pane1El) {
        chart1.applyOptions({ width: pane1El.clientWidth, height: pane1El.clientHeight });
      }
      if (chart2 && pane2El) {
        chart2.applyOptions({ width: pane2El.clientWidth, height: pane2El.clientHeight });
      }
    } catch(e) {
      console.warn('[MultiView] resizeCharts error: ' + e.message);
    }
  }

  /**
   * 应用主题切换
   */
  function applyTheme() {
    try {
      if (layout === 'single' || !chart1 || !chart2) return;
      var co = chartColors();

      // 更新图表背景和文字颜色
      [chart1, chart2].forEach(function(ch) {
        if (!ch) return;
        ch.applyOptions({
          layout: { background: { color: co.bg }, textColor: co.txt },
          grid: {
            vertLines: { color: co.grid },
            horzLines: { color: co.grid }
          },
          rightPriceScale: { borderColor: co.bd },
          timeScale: { borderColor: co.bd }
        });
      });

      // 更新K线颜色
      [series1, series2].forEach(function(s) {
        if (!s) return;
        s.applyOptions({
          upColor: co.up, downColor: co.dn,
          borderUpColor: co.up, borderDownColor: co.dn,
          wickUpColor: co.up, wickDownColor: co.dn
        });
      });

      // 更新MA颜色
      [ma1_5, ma2_5].forEach(function(s) { if (s) s.applyOptions({ color: co.ma5 }); });
      [ma1_10, ma2_10].forEach(function(s) { if (s) s.applyOptions({ color: co.ma10 }); });

      // 更新周期按钮样式
      var allBtns = document.querySelectorAll('.mv-period-buttons button');
      for (var i = 0; i < allBtns.length; i++) {
        var btn = allBtns[i];
        btn.style.borderColor = isDark() ? '#3a3a3a' : '#e0e0e0';
        btn.style.color = isDark() ? '#ccc' : '#333';
        var paneIdx = parseInt(btn.dataset.pane);
        var currentPeriod = paneIdx === 0 ? period1 : period2;
        btn.style.background = btn.dataset.period === currentPeriod ?
          (isDark() ? '#333' : '#e0e0e0') :
          (isDark() ? '#1a1a1a' : '#fafafa');
      }
    } catch(e) {
      console.warn('[MultiView] applyTheme error: ' + e.message);
    }
  }

  // ────── 持久化 ──────
  function saveLayout() {
    try {
      var data = {
        layout: layout,
        period1: period1,
        period2: period2
      };
      localStorage.setItem('kline_multiview', JSON.stringify(data));
    } catch(e) {}
  }

  // ────── Public API ──────
  return {
    init: init,
    setLayout: setLayout,
    getLayout: getLayout,
    updateCandles: updateCandles,
    setPeriod: setPeriod,
    destroy: destroy,
    resizeCharts: resizeCharts,
    applyTheme: applyTheme
  };

})();
