/* ============================================
   compare.js — 多股对比叠加层
   指数化归一（基准=100），线条叠加 + 相关性矩阵
   使用 LightweightCharts v4 UMD
   ============================================ */

const StockCompare = (() => {

  // ────── 状态 ──────
  var activeSymbols = [];     // 当前选中的股票代码
  var panelEl = null;         // 浮动面板 DOM
  var chartEl = null;         // 对比图表 DOM
  var matrixEl = null;        // 相关性矩阵 DOM
  var chart = null;           // LightweightCharts 实例
  var lineSeries = {};        // { symbol: series } 预创建的线系列
  var showingMatrix = false;  // 是否正在显示相关性矩阵
  var initialized = false;

  // 8色调色板（色盲友好）
  var PALETTE = [
    '#ff5252', // 红
    '#42a5f5', // 蓝
    '#66bb6a', // 绿
    '#f5a623', // 橙
    '#ce93d8', // 紫
    '#26c6da', // 青
    '#ffa726', // 深橙
    '#9ccc65', // 黄绿
  ];

  // ────── 主题 ──────
  function isDark() {
    return document.documentElement.dataset.theme !== 'light';
  }

  function chartColors() {
    var d = isDark();
    return {
      bg: d ? '#0d0d0d' : '#fff',
      txt: d ? '#999' : '#666',
      grid: d ? '#1a1a1a' : '#f0f0f0',
      bd: d ? '#2a2a2a' : '#e0e0e0'
    };
  }

  // ────── 获取股票颜色 ──────
  function getColorForSymbol(sym, index) {
    if (index !== undefined && index < PALETTE.length) {
      return PALETTE[index];
    }
    // 用代码的hash确定颜色
    var hash = 0;
    for (var i = 0; i < sym.length; i++) {
      hash = ((hash << 5) - hash) + sym.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return PALETTE[Math.abs(hash) % PALETTE.length];
  }

  // ────── 获取K线数据 ──────
  function getCandlesForSymbol(sym) {
    try {
      if (typeof Simulator !== 'undefined') {
        var sim = Simulator.get(sym);
        if (sim && sim.getCandles) {
          return sim.getCandles();
        }
      }
      return [];
    } catch(e) { return []; }
  }

  // ────── 指数化归一：每条线的起点设为100 ──────
  /**
   * 计算归一化数据
   * 找到所有股票共同覆盖的时间段的第一个价格，设为100
   * 后续所有价格 = (price / basePrice) * 100
   *
   * @returns {object} { symbols: { sym: [{time, value}], ... }, baseTime, commonStart }
   */
  function calcNormalized() {
    try {
      if (activeSymbols.length === 0) return { symbols: {} };

      // 收集所有股票的蜡烛数据
      var allCandles = {};
      for (var s = 0; s < activeSymbols.length; s++) {
        var sym = activeSymbols[s];
        var raw = getCandlesForSymbol(sym);
        if (raw && raw.length > 0) {
          allCandles[sym] = raw;
        }
      }

      var syms = Object.keys(allCandles);
      if (syms.length === 0) return { symbols: {} };

      // 找到所有股票共同覆盖的最大起始时间
      var commonStart = 0;
      for (var i = 0; i < syms.length; i++) {
        var candles = allCandles[syms[i]];
        if (candles.length > 0) {
          var firstTime = candles[0].time;
          if (firstTime > commonStart) commonStart = firstTime;
        }
      }

      // 建仓：每只股票在共同起始时间的收盘价（或该时间之后的第一根K线）
      var basePrices = {};
      for (var i = 0; i < syms.length; i++) {
        var sym = syms[i];
        var candles = allCandles[sym];
        // 找到 commonStart 时间点或之后第一根K线
        var baseClose = null;
        for (var j = 0; j < candles.length; j++) {
          if (candles[j].time >= commonStart) {
            baseClose = candles[j].close;
            break;
          }
        }
        if (baseClose !== null && baseClose > 0) {
          basePrices[sym] = baseClose;
        } else if (candles.length > 0) {
          // 回退：使用最后一根
          basePrices[sym] = candles[candles.length - 1].close;
        }
      }

      // 如果没有基准价格，返回空
      if (Object.keys(basePrices).length === 0) return { symbols: {} };

      // 为每只股票生成归一化序列
      var result = {};
      for (var i = 0; i < syms.length; i++) {
        var sym = syms[i];
        var candles = allCandles[sym];
        var base = basePrices[sym];
        if (!base || base <= 0) continue;

        var series = [];
        for (var j = 0; j < candles.length; j++) {
          var c = candles[j];
          if (c.time >= commonStart) {
            series.push({
              time: Math.floor(c.time / 1000),
              value: +((c.close / base) * 100).toFixed(2)
            });
          }
        }
        if (series.length > 0) {
          result[sym] = series;
        }
      }

      return {
        symbols: result,
        baseTime: commonStart,
        basePrices: basePrices
      };
    } catch(e) {
      console.warn('[StockCompare] calcNormalized error: ' + e.message);
      return { symbols: {} };
    }
  }

  // ────── Pearson 相关系数 ──────
  function pearsonCorrelation(x, y) {
    var n = Math.min(x.length, y.length);
    if (n < 5) return 0;

    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (var i = 0; i < n; i++) {
      sumX += x[i];
      sumY += y[i];
      sumXY += x[i] * y[i];
      sumX2 += x[i] * x[i];
      sumY2 += y[i] * y[i];
    }

    var num = n * sumXY - sumX * sumY;
    var den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    if (Math.abs(den) < 0.000001) return 0;
    return num / den;
  }

  // ────── 构建相关性矩阵数据 ──────
  function calcCorrelationMatrix() {
    try {
      if (activeSymbols.length < 2) return null;

      // 收集所有股票在共同时间段内的收盘价序列
      var allCandles = {};
      var commonStart = 0;
      var commonEnd = Infinity;

      for (var s = 0; s < activeSymbols.length; s++) {
        var sym = activeSymbols[s];
        var raw = getCandlesForSymbol(sym);
        if (raw && raw.length > 0) {
          allCandles[sym] = raw;
          if (raw[0].time > commonStart) commonStart = raw[0].time;
          if (raw[raw.length - 1].time < commonEnd) commonEnd = raw[raw.length - 1].time;
        }
      }

      var syms = Object.keys(allCandles);

      // 提取每个股票在共同时间段的收盘价
      var priceSeries = {};
      for (var i = 0; i < syms.length; i++) {
        var sym = syms[i];
        var candles = allCandles[sym];
        var prices = [];
        for (var j = 0; j < candles.length; j++) {
          if (candles[j].time >= commonStart && candles[j].time <= commonEnd) {
            prices.push(candles[j].close);
          }
        }
        if (prices.length >= 5) {
          priceSeries[sym] = prices;
        }
      }

      // 使用价格变化率（收益率）计算相关性，比绝对价格更有意义
      var returnSeries = {};
      var finalSyms = Object.keys(priceSeries);
      for (var i = 0; i < finalSyms.length; i++) {
        var sym = finalSyms[i];
        var prices = priceSeries[sym];
        var returns = [];
        for (var j = 1; j < prices.length; j++) {
          returns.push((prices[j] - prices[j - 1]) / prices[j - 1]);
        }
        returnSeries[sym] = returns;
      }

      // 计算成对相关性
      var matrix = {};
      for (var i = 0; i < finalSyms.length; i++) {
        var symA = finalSyms[i];
        if (!matrix[symA]) matrix[symA] = {};
        for (var j = 0; j < finalSyms.length; j++) {
          var symB = finalSyms[j];
          if (i === j) {
            matrix[symA][symB] = 1.0;
          } else if (j < i) {
            // 对称，复用已计算的值
            matrix[symA][symB] = matrix[symB][symA];
          } else {
            var corr = pearsonCorrelation(returnSeries[symA], returnSeries[symB]);
            matrix[symA][symB] = +corr.toFixed(3);
          }
        }
      }

      return { matrix: matrix, symbols: finalSyms };
    } catch(e) {
      console.warn('[StockCompare] calcCorrelationMatrix error: ' + e.message);
      return null;
    }
  }

  // ────── 创建对比图表 ──────
  function createCompareChart() {
    if (!chartEl) return;

    var co = chartColors();
    chart = LightweightCharts.createChart(chartEl, {
      layout: { background: { color: co.bg }, textColor: co.txt },
      grid: {
        vertLines: { color: co.grid },
        horzLines: { color: co.grid }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal
      },
      rightPriceScale: {
        borderColor: co.bd,
        scaleMargins: { top: 0.1, bottom: 0.1 }
      },
      timeScale: { borderColor: co.bd, timeVisible: false, secondsVisible: false },
      height: 150
    });

    // 预创建所有股票的线系列（在init时一次性创建，避免v4 UMD动态创建问题）
    var allSyms = Object.keys(Simulator.STOCKS || {});
    for (var i = 0; i < allSyms.length; i++) {
      var sym = allSyms[i];
      lineSeries[sym] = chart.addLineSeries({
        color: getColorForSymbol(sym, i),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        visible: false
      });
    }
  }

  // ────── 构建浮动面板 HTML ──────
  function buildPanel() {
    // 如果已存在，先移除
    if (panelEl && panelEl.parentNode) {
      panelEl.parentNode.removeChild(panelEl);
    }

    var d = isDark();
    var bg = d ? 'rgba(26,26,26,0.95)' : 'rgba(255,255,255,0.95)';
    var bd = d ? '#3a3a3a' : '#e0e0e0';
    var txt = d ? '#e0e0e0' : '#333';
    var txt2 = d ? '#999' : '#666';

    panelEl = document.createElement('div');
    panelEl.id = 'comparePanel';
    panelEl.style.cssText =
      'position:absolute;bottom:8px;left:8px;width:260px;max-height:420px;' +
      'background:' + bg + ';border:1px solid ' + bd + ';border-radius:6px;' +
      'z-index:10;display:flex;flex-direction:column;overflow:hidden;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.3);font-family:var(--font-stack, sans-serif);' +
      'font-size:11px;color:' + txt + ';';

    // 头部
    var header = document.createElement('div');
    header.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;' +
      'padding:4px 8px;border-bottom:1px solid ' + bd + ';flex-shrink:0;';
    header.innerHTML =
      '<span style="font-weight:600;">📊 多股对比</span>' +
      '<button id="compareCloseBtn" style="background:none;border:none;color:' + txt2 +
      ';cursor:pointer;font-size:14px;padding:0 4px;" title="关闭">✕</button>';
    panelEl.appendChild(header);

    // 股票checkbox列表（可滚动）
    var listWrap = document.createElement('div');
    listWrap.id = 'compareStockList';
    listWrap.style.cssText =
      'max-height:120px;overflow-y:auto;padding:4px 8px;flex-shrink:0;';
    panelEl.appendChild(listWrap);

    // 图表区域
    chartEl = document.createElement('div');
    chartEl.id = 'compareChart';
    chartEl.style.cssText =
      'height:150px;flex-shrink:0;border-top:1px solid ' + bd + ';position:relative;';
    panelEl.appendChild(chartEl);

    // 相关性矩阵容器（初始隐藏）
    matrixEl = document.createElement('div');
    matrixEl.id = 'compareMatrix';
    matrixEl.style.cssText =
      'display:none;flex-shrink:1;overflow:auto;padding:4px 8px;' +
      'border-top:1px solid ' + bd + ';min-height:100px;max-height:200px;';
    panelEl.appendChild(matrixEl);

    // 底部按钮
    var footer = document.createElement('div');
    footer.style.cssText =
      'display:flex;gap:4px;padding:4px 8px;border-top:1px solid ' + bd + ';flex-shrink:0;';
    footer.innerHTML =
      '<button id="compareMatrixBtn" style="flex:1;padding:3px 6px;border:1px solid ' + bd +
      ';border-radius:4px;background:' + (d ? '#222' : '#f5f5f5') + ';color:' + txt +
      ';cursor:pointer;font-size:10px;font-family:var(--font-stack, sans-serif);">相关性矩阵</button>';
    panelEl.appendChild(footer);

    // 找到chart-area并插入
    var chartArea = document.querySelector('.chart-area');
    if (chartArea) {
      // 确保 chart-area 有相对定位
      var computedStyle = window.getComputedStyle(chartArea);
      if (computedStyle.position === 'static') {
        chartArea.style.position = 'relative';
      }
      chartArea.appendChild(panelEl);
    }

    // 绑定事件
    setTimeout(function() {
      var closeBtn = document.getElementById('compareCloseBtn');
      if (closeBtn) {
        closeBtn.addEventListener('click', function() {
          // 关闭面板 = 清除所有选中
          StockCompare._closePanel();
        });
      }

      var matrixBtn = document.getElementById('compareMatrixBtn');
      if (matrixBtn) {
        matrixBtn.addEventListener('click', function() {
          StockCompare.showCorrelationMatrix();
        });
      }
    }, 10);

    // 渲染股票列表
    renderStockCheckboxes();
  }

  // ────── 渲染股票选择checkbox ──────
  function renderStockCheckboxes() {
    var listWrap = document.getElementById('compareStockList');
    if (!listWrap) return;

    var stocks = Simulator.STOCKS || {};
    var syms = Object.keys(stocks);

    listWrap.innerHTML = '';

    for (var i = 0; i < syms.length; i++) {
      var sym = syms[i];
      var stock = stocks[sym];
      var isChecked = activeSymbols.indexOf(sym) >= 0;
      var color = getColorForSymbol(sym, i);

      var row = document.createElement('label');
      row.style.cssText =
        'display:flex;align-items:center;gap:6px;padding:2px 0;' +
        'cursor:pointer;font-size:11px;';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isChecked;
      cb.dataset.symbol = sym;
      cb.style.cssText = 'margin:0;accent-color:' + color + ';';

      var dot = document.createElement('span');
      dot.style.cssText =
        'display:inline-block;width:8px;height:8px;border-radius:50%;' +
        'background:' + color + ';flex-shrink:0;';

      var label = document.createElement('span');
      label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      label.textContent = sym + ' ' + stock.name;

      // 使用IIFE捕获sym
      (function(symbol) {
        cb.addEventListener('change', function() {
          if (this.checked) {
            StockCompare.addSymbol(symbol);
          } else {
            StockCompare.removeSymbol(symbol);
          }
        });
      })(sym);

      row.appendChild(cb);
      row.appendChild(dot);
      row.appendChild(label);
      listWrap.appendChild(row);
    }
  }

  // ────── 隐藏相关性矩阵，显示图表 ──────
  function showChartView() {
    showingMatrix = false;
    if (chartEl) chartEl.style.display = '';
    if (matrixEl) matrixEl.style.display = 'none';
    var btn = document.getElementById('compareMatrixBtn');
    if (btn) btn.textContent = '相关性矩阵';
  }

  // ────── Public API ──────

  /**
   * 初始化比较面板
   * @param {string} overlayContainerId - 没用到的参数，保留兼容性
   */
  function init(overlayContainerId) {
    try {
      // 从 localStorage 恢复
      var saved = localStorage.getItem('kline_compare_symbols');
      if (saved) {
        try {
          activeSymbols = JSON.parse(saved);
        } catch(e) { activeSymbols = []; }
      }

      buildPanel();
      initialized = true;

      // 如果有已保存的选中股票，构建图表
      if (activeSymbols.length > 0) {
        setTimeout(function() {
          createCompareChart();
          update();
        }, 100);
      } else {
        // 延迟创建图表（等面板渲染完成）
        setTimeout(function() {
          createCompareChart();
        }, 100);
      }
    } catch(e) {
      console.warn('[StockCompare] init error: ' + e.message);
    }
  }

  /**
   * 添加股票到对比列表
   * @param {string} sym - 股票代码
   */
  function addSymbol(sym) {
    try {
      if (!Simulator.STOCKS[sym]) return;
      if (activeSymbols.indexOf(sym) >= 0) return; // 已存在

      activeSymbols.push(sym);
      saveSymbols();
      update();

      // 更新checkbox状态
      renderStockCheckboxes();
    } catch(e) {
      console.warn('[StockCompare] addSymbol error: ' + e.message);
    }
  }

  /**
   * 从对比列表移除股票
   * @param {string} sym - 股票代码
   */
  function removeSymbol(sym) {
    try {
      var idx = activeSymbols.indexOf(sym);
      if (idx < 0) return;

      activeSymbols.splice(idx, 1);

      // 隐藏对应的线系列
      if (lineSeries[sym]) {
        try { lineSeries[sym].setData([]); } catch(e) {}
        lineSeries[sym].applyOptions({ visible: false });
      }

      saveSymbols();
      update();

      // 更新checkbox状态
      renderStockCheckboxes();
    } catch(e) {
      console.warn('[StockCompare] removeSymbol error: ' + e.message);
    }
  }

  /**
   * 获取当前选中的股票代码列表
   * @returns {Array}
   */
  function getSymbols() {
    return activeSymbols.slice();
  }

  /**
   * 更新所有对比数据
   */
  function update() {
    try {
      if (!chart) return;
      if (activeSymbols.length === 0) {
        // 隐藏所有线
        var allSyms = Object.keys(lineSeries);
        for (var i = 0; i < allSyms.length; i++) {
          try {
            lineSeries[allSyms[i]].setData([]);
            lineSeries[allSyms[i]].applyOptions({ visible: false });
          } catch(e) {}
        }
        return;
      }

      var normData = calcNormalized();
      var symbols = normData.symbols;

      // 更新每个线系列
      var allSyms = Object.keys(lineSeries);
      for (var i = 0; i < allSyms.length; i++) {
        var sym = allSyms[i];
        var data = symbols[sym];

        if (data && data.length > 0 && activeSymbols.indexOf(sym) >= 0) {
          lineSeries[sym].setData(data);
          lineSeries[sym].applyOptions({ visible: true });
        } else {
          lineSeries[sym].setData([]);
          lineSeries[sym].applyOptions({ visible: false });
        }
      }

      // 自适应显示范围
      try { chart.timeScale().fitContent(); } catch(e) {}

      // 如果正在显示矩阵，也刷新矩阵
      if (showingMatrix) {
        renderMatrix();
      }
    } catch(e) {
      console.warn('[StockCompare] update error: ' + e.message);
    }
  }

  /**
   * 显示相关性矩阵
   */
  function showCorrelationMatrix() {
    try {
      if (showingMatrix) {
        // 切换回图表
        showChartView();
        return;
      }

      var corrData = calcCorrelationMatrix();
      if (!corrData || corrData.symbols.length < 2) {
        console.warn('[StockCompare] 需要至少2只股票才能计算相关性');
        return;
      }

      showingMatrix = true;
      if (chartEl) chartEl.style.display = 'none';
      if (matrixEl) matrixEl.style.display = '';
      var btn = document.getElementById('compareMatrixBtn');
      if (btn) btn.textContent = '返回图表';

      renderMatrix();
    } catch(e) {
      console.warn('[StockCompare] showCorrelationMatrix error: ' + e.message);
    }
  }

  /**
   * 渲染相关性矩阵到 DOM
   */
  function renderMatrix() {
    try {
      if (!matrixEl) return;

      var corrData = calcCorrelationMatrix();
      if (!corrData || corrData.symbols.length < 2) {
        matrixEl.innerHTML = '<div style="padding:16px;text-align:center;color:#999;">需要至少2只股票计算相关性</div>';
        return;
      }

      var symbols = corrData.symbols;
      var matrix = corrData.matrix;
      var d = isDark();
      var txt = d ? '#e0e0e0' : '#333';
      var bg = d ? '#1a1a1a' : '#fff';

      // 构建表格
      var html = '<table style="width:100%;border-collapse:collapse;font-size:10px;color:' + txt + ';">';

      // 表头
      html += '<tr><th style="padding:2px 4px;text-align:left;font-weight:600;"></th>';
      for (var i = 0; i < symbols.length; i++) {
        html += '<th style="padding:2px 4px;text-align:center;font-weight:600;font-size:9px;">' +
                symbols[i] + '</th>';
      }
      html += '</tr>';

      // 数据行
      for (var r = 0; r < symbols.length; r++) {
        var symR = symbols[r];
        html += '<tr>';
        html += '<td style="padding:2px 4px;font-weight:600;font-size:9px;white-space:nowrap;">' + symR + '</td>';

        for (var c = 0; c < symbols.length; c++) {
          var symC = symbols[c];
          var val = matrix[symR][symC];

          // 颜色编码：正值=绿，负值=红，中性=灰
          var rCol, gCol, bCol;
          if (val >= 0) {
            // 正值：绿色
            var intensity = Math.min(1, val);
            rCol = Math.floor(60 * (1 - intensity));
            gCol = Math.floor(140 + 60 * intensity);
            bCol = Math.floor(100 * (1 - intensity));
          } else {
            // 负值：红色
            var intensity = Math.min(1, Math.abs(val));
            rCol = Math.floor(180 + 60 * intensity);
            gCol = Math.floor(100 * (1 - intensity));
            bCol = Math.floor(80 * (1 - intensity));
          }
          var bgColor = 'rgba(' + rCol + ',' + gCol + ',' + bCol + ',' + Math.abs(val) * 0.5 + ')';

          html += '<td style="padding:2px 4px;text-align:center;background:' + bgColor +
                  ';border-radius:2px;font-size:10px;' +
                  (val >= 0.7 ? 'font-weight:700;' : '') +
                  (val <= -0.7 ? 'font-weight:700;' : '') +
                  '">' + val.toFixed(2) + '</td>';
        }
        html += '</tr>';
      }
      html += '</table>';

      // 图例
      html += '<div style="display:flex;justify-content:center;gap:8px;margin-top:6px;font-size:9px;color:' +
              (d ? '#999' : '#666') + ';">' +
              '<span>🟢 正相关</span><span>⚪ 无关</span><span>🔴 负相关</span></div>';

      matrixEl.innerHTML = html;
    } catch(e) {
      console.warn('[StockCompare] renderMatrix error: ' + e.message);
    }
  }

  /**
   * 当前是否处于比较模式
   * @returns {boolean}
   */
  function isActive() {
    return initialized && panelEl !== null && panelEl.parentNode !== null;
  }

  /**
   * 关闭面板（内部方法）
   */
  function _closePanel() {
    activeSymbols = [];
    saveSymbols();
    if (panelEl && panelEl.parentNode) {
      panelEl.parentNode.removeChild(panelEl);
    }
    panelEl = null;
    chartEl = null;
    matrixEl = null;
    chart = null;
    lineSeries = {};
    showingMatrix = false;
    initialized = false;
  }

  /**
   * 销毁对比面板
   */
  function destroy() {
    _closePanel();
    localStorage.removeItem('kline_compare_symbols');
  }

  /**
   * 应用主题
   */
  function applyTheme() {
    try {
      if (!chart) return;
      var co = chartColors();
      chart.applyOptions({
        layout: { background: { color: co.bg }, textColor: co.txt },
        grid: {
          vertLines: { color: co.grid },
          horzLines: { color: co.grid }
        },
        rightPriceScale: { borderColor: co.bd },
        timeScale: { borderColor: co.bd }
      });

      // 重新渲染面板样式
      if (panelEl) {
        var d = isDark();
        panelEl.style.background = d ? 'rgba(26,26,26,0.95)' : 'rgba(255,255,255,0.95)';
        panelEl.style.borderColor = d ? '#3a3a3a' : '#e0e0e0';
        panelEl.style.color = d ? '#e0e0e0' : '#333';

        // 重新渲染checkbox
        renderStockCheckboxes();
      }

      // 重新渲染矩阵（如果正在显示）
      if (showingMatrix && matrixEl) {
        renderMatrix();
      }
    } catch(e) {
      console.warn('[StockCompare] applyTheme error: ' + e.message);
    }
  }

  // ────── 持久化 ──────
  function saveSymbols() {
    try {
      localStorage.setItem('kline_compare_symbols', JSON.stringify(activeSymbols));
    } catch(e) {}
  }

  // ────── Public API ──────
  return {
    init: init,
    addSymbol: addSymbol,
    removeSymbol: removeSymbol,
    getSymbols: getSymbols,
    update: update,
    showCorrelationMatrix: showCorrelationMatrix,
    isActive: isActive,
    destroy: destroy,
    applyTheme: applyTheme,
    _closePanel: _closePanel
  };

})();
