/* ============================================
   quant-trading.js — 量化交易引擎
   自动化策略执行 · A股政策合规 · T+1结算
   ============================================ */

const QuantTrading = (() => {

  // ============================================================
  //  TECHNICAL INDICATORS (internal, no chart.js dependency)
  // ============================================================

  /** Simple Moving Average */
  function calcSMA(data, period) {
    if (!data || data.length < period) return [];
    var result = new Array(data.length);
    for (var i = 0; i < data.length; i++) {
      if (i < period - 1) { result[i] = null; continue; }
      var sum = 0;
      for (var j = i - period + 1; j <= i; j++) sum += data[j];
      result[i] = sum / period;
    }
    return result;
  }

  /** Exponential Moving Average */
  function calcEMA(data, period) {
    if (!data || data.length === 0) return [];
    var result = new Array(data.length);
    var k = 2 / (period + 1);
    // Initialize with SMA for first EMA value
    var firstIdx = -1;
    for (var i = period - 1; i < data.length; i++) {
      if (firstIdx < 0) {
        var sum = 0;
        for (var j = i - period + 1; j <= i; j++) sum += data[j];
        result[i] = sum / period;
        firstIdx = i;
        continue;
      }
      result[i] = result[i - 1] !== null
        ? data[i] * k + result[i - 1] * (1 - k)
        : null;
    }
    // Fill nulls before firstIdx
    for (var i = 0; i < firstIdx; i++) result[i] = null;
    return result;
  }

  /** Relative Strength Index */
  function calcRSI(closes, period) {
    if (!closes || closes.length < period + 1) return [];
    var result = new Array(closes.length);
    for (var i = 0; i < closes.length; i++) { result[i] = null; }

    var gains = 0, losses = 0;
    // First average gain/loss
    for (var i = 1; i <= period; i++) {
      var diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff; else losses += Math.abs(diff);
    }
    var avgGain = gains / period;
    var avgLoss = losses / period;

    for (var i = period; i < closes.length; i++) {
      if (avgLoss === 0) { result[i] = 100; }
      else {
        var rs = avgGain / avgLoss;
        result[i] = 100 - (100 / (1 + rs));
      }
      // Update for next iteration
      if (i + 1 < closes.length) {
        var d = closes[i + 1] - closes[i];
        avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
        avgLoss = (avgLoss * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
      }
    }
    return result;
  }

  /** MACD: returns { macdLine, signalLine, histogram } arrays */
  function calcMACD(closes, fast, slow, signal) {
    fast = fast || 12;
    slow = slow || 26;
    signal = signal || 9;

    var emaFast = calcEMA(closes, fast);
    var emaSlow = calcEMA(closes, slow);

    var macdLine = new Array(closes.length);
    for (var i = 0; i < closes.length; i++) {
      if (emaFast[i] !== null && emaSlow[i] !== null && emaFast[i] !== undefined && emaSlow[i] !== undefined) {
        macdLine[i] = emaFast[i] - emaSlow[i];
      } else {
        macdLine[i] = null;
      }
    }

    // Build non-null MACD line with index tracking for proper alignment
    var nonNullMACD = [];
    for (var k = 0; k < macdLine.length; k++) {
      if (macdLine[k] !== null) nonNullMACD.push(macdLine[k]);
    }
    var signalRaw = calcEMA(nonNullMACD, signal);
    // Map signal back to original index positions
    var signalPadded = new Array(macdLine.length);
    var sigIdx = 0;
    for (var i = 0; i < macdLine.length; i++) {
      if (macdLine[i] === null) {
        signalPadded[i] = null;
      } else {
        signalPadded[i] = (sigIdx < signalRaw.length) ? signalRaw[sigIdx] : null;
        sigIdx++;
      }
    }

    var histogram = new Array(macdLine.length);
    for (var i = 0; i < macdLine.length; i++) {
      if (macdLine[i] !== null && signalPadded[i] !== null) {
        histogram[i] = macdLine[i] - signalPadded[i];
      } else {
        histogram[i] = null;
      }
    }

    return { macdLine: macdLine, signalLine: signalPadded, histogram: histogram };
  }

  /** Bollinger Bands: returns { upper, middle, lower } arrays */
  function calcBollingerBands(closes, period, multiplier) {
    period = period || 20;
    multiplier = multiplier || 2.0;

    var middle = calcSMA(closes, period);
    var upper = new Array(closes.length);
    var lower = new Array(closes.length);

    for (var i = 0; i < closes.length; i++) {
      if (middle[i] === null) {
        upper[i] = null; lower[i] = null; continue;
      }
      var sumSq = 0;
      for (var j = i - period + 1; j <= i; j++) {
        sumSq += Math.pow(closes[j] - middle[i], 2);
      }
      var stdDev = Math.sqrt(sumSq / period);
      upper[i] = middle[i] + multiplier * stdDev;
      lower[i] = middle[i] - multiplier * stdDev;
    }

    return { upper: upper, middle: middle, lower: lower };
  }

  // ============================================================
  //  ENGINE STATE
  // ============================================================

  var enabled = false;
  var activeStrategies = {};   // { symbol: { maCross: true, rsi: false, ... } }
  var strategyConfigs = {};    // per-symbol overrides of global configs
  var tradeLog = [];           // auto-trade history
  var maxDailyTrades = 50;
  var dailyTradeCount = 0;
  var lastTradeDate = '';

  // T+1 settlement tracking: { symbol: [ { shares, buyDate, buyPrice } ] }
  var unsettledShares = {};

  // Grid trading state per symbol
  var gridState = {};  // { symbol: { buyLevels: [], sellLevels: [], filledBuyLevels: {}, filledSellLevels: {}, basePrice, gridSpacing } }

  // Circuit breaker
  var circuitBreakerActive = false;
  var volatilityWarnings = {}; // { symbol: { lastCheck, extremeDetected } }

  // Signal cooldown (prevent rapid re-entry)
  var signalCooldown = {};  // { symbol_strategy: timestamp }

  // Cross tracking for MA and MACD (previous bar cross state)
  var crossState = {};  // { symbol: { maAbove: bool, macdAbove: bool } }

  // ============================================================
  //  GLOBAL STRATEGY CONFIG DEFAULTS
  // ============================================================

  var globalConfig = {
    maCross:     { enabled: true,  shortPeriod: 5,    longPeriod: 20,   allowedSymbols: [] }, // empty = all
    rsi:         { enabled: false, period: 14,        oversold: 30,    overbought: 70, allowedSymbols: [] },
    macd:        { enabled: false, fastPeriod: 12,    slowPeriod: 26,  signalPeriod: 9, allowedSymbols: [] },
    bollinger:   { enabled: false, period: 20,        multiplier: 2.0, allowedSymbols: [] },
    grid:        { enabled: false, spacingPct: 2.0,   levels: 5,       maxPositionPct: 30, allowedSymbols: [] }
  };

  // ============================================================
  //  A-SHARE POLICY COMPLIANCE
  // ============================================================

  /** Check if price is within daily price limit */
  function isPriceWithinLimit(symbol, price) {
    var cfg = Simulator.STOCKS[symbol];
    if (!cfg) return true; // unknown stock, allow
    var sim = Simulator.get(symbol);
    var candles = sim.getCandles();
    if (candles.length === 0) return true;

    // Find previous day's close (approximate using last candle close)
    var prevClose = cfg.basePrice;
    if (candles.length > 0) {
      // Use the close of the earliest candle as reference, or basePrice
      prevClose = candles[candles.length - 1].close;
    }
    var limitPct = cfg.limitPct || 0.10;
    var limitUp = prevClose * (1 + limitPct);
    var limitDown = prevClose * (1 - limitPct);

    return price >= limitDown && price <= limitUp;
  }

  /** Get settled (T+1 cleared) shares for a symbol */
  function getSettledShares(symbol) {
    var pos = getTraderPosition(symbol);
    if (!pos || pos.shares === 0) return 0;

    var unsettled = unsettledShares[symbol];
    if (!unsettled || unsettled.length === 0) return pos.shares;

    var today = new Date().toDateString();
    var unsettledTotal = 0;
    for (var i = unsettled.length - 1; i >= 0; i--) {
      var entry = unsettled[i];
      if (entry.buyDate === today) {
        unsettledTotal += entry.shares;
      }
    }

    // Clean up old entries
    unsettledShares[symbol] = unsettled.filter(function(e) {
      return e.buyDate === today;
    });

    return Math.max(0, pos.shares - unsettledTotal);
  }

  /** Check single-stock position limit (30% of total portfolio) */
  function checkPositionLimit(symbol, additionalShares) {
    var cfg = Simulator.STOCKS[symbol];
    if (!cfg) return { allowed: true };

    var sim = Simulator.get(symbol);
    var price = sim.getPrice();
    var totalAssets = Trader.getSummary().totalAssets;
    var pos = getTraderPosition(symbol);
    var currentShares = pos ? pos.shares : 0;

    var maxAllowedValue = totalAssets * 0.30;
    var proposedValue = (currentShares + additionalShares) * price;

    if (proposedValue > maxAllowedValue) {
      var maxAdditional = Math.floor((maxAllowedValue - currentShares * price) / price / 100) * 100;
      return {
        allowed: false,
        maxAdditional: Math.max(0, maxAdditional),
        message: '单股持仓不能超过总资产30% (A股基金规定)'
      };
    }
    return { allowed: true };
  }

  /** Check circuit breaker / extreme volatility */
  function checkCircuitBreaker(symbol) {
    var now = Date.now();
    var state = volatilityWarnings[symbol];
    if (!state) {
      volatilityWarnings[symbol] = { lastCheck: now, extremeDetected: false, priceAtCheck: 0 };
      state = volatilityWarnings[symbol];
    }

    // Check every 5 minutes (in sim time, roughly)
    if (now - state.lastCheck < 60000) {
      return state.extremeDetected;
    }

    var sim = Simulator.get(symbol);
    var candles = sim.getCandles();
    if (candles.length < 20) return false;

    // Check last 20 candles for abnormal moves
    var recentCloses = [];
    for (var i = Math.max(0, candles.length - 20); i < candles.length; i++) {
      recentCloses.push(candles[i].close);
    }

    if (recentCloses.length < 10) return false;

    // Detect > 5% move in last 10 bars
    var startPrice = recentCloses[0];
    var endPrice = recentCloses[recentCloses.length - 1];

    // Also check for gap moves
    var maxMove = 0;
    for (var i = 1; i < recentCloses.length; i++) {
      var move = Math.abs((recentCloses[i] - recentCloses[i - 1]) / recentCloses[i - 1]) * 100;
      if (move > maxMove) maxMove = move;
    }

    state.extremeDetected = (maxMove > 8) || (Math.abs((endPrice - startPrice) / startPrice) * 100 > 10);
    state.lastCheck = now;
    state.priceAtCheck = endPrice;

    if (state.extremeDetected) {
      circuitBreakerActive = true;
      // Auto-reset after 5 minutes of stability
      setTimeout(function() {
        state.extremeDetected = false;
        circuitBreakerActive = false;
      }, 300000);
    }

    return state.extremeDetected;
  }

  /** Get trader position info safely */
  function getTraderPosition(symbol) {
    try {
      return Trader.getPositionInfo(symbol);
    } catch(e) { return null; }
  }

  // ============================================================
  //  STRATEGY SIGNAL GENERATION
  // ============================================================

  /** MA Cross Strategy */
  function checkMACross(symbol, candles) {
    var cfg = getStrategyConfig(symbol, 'maCross');
    var closes = candles.map(function(c) { return c.close; });
    if (closes.length < cfg.longPeriod + 1) return null;

    var shortMA = calcSMA(closes, cfg.shortPeriod);
    var longMA = calcSMA(closes, cfg.longPeriod);

    var lastIdx = closes.length - 1;
    var prevIdx = lastIdx - 1;

    if (shortMA[lastIdx] === null || longMA[lastIdx] === null) return null;
    if (shortMA[prevIdx] === null || longMA[prevIdx] === null) return null;

    var prevAbove = shortMA[prevIdx] > longMA[prevIdx];
    var currAbove = shortMA[lastIdx] > longMA[lastIdx];

    // Golden cross: short crosses above long
    if (!prevAbove && currAbove) {
      return {
        strategy: 'MA金叉',
        side: 'buy',
        strength: Math.abs((shortMA[lastIdx] - longMA[lastIdx]) / longMA[lastIdx] * 100),
        meta: { shortMA: shortMA[lastIdx], longMA: longMA[lastIdx] }
      };
    }
    // Death cross: short crosses below long
    if (prevAbove && !currAbove) {
      return {
        strategy: 'MA死叉',
        side: 'sell',
        strength: Math.abs((longMA[lastIdx] - shortMA[lastIdx]) / longMA[lastIdx] * 100),
        meta: { shortMA: shortMA[lastIdx], longMA: longMA[lastIdx] }
      };
    }
    return null;
  }

  /** RSI Mean Reversion Strategy */
  function checkRSI(symbol, candles) {
    var cfg = getStrategyConfig(symbol, 'rsi');
    var closes = candles.map(function(c) { return c.close; });
    if (closes.length < cfg.period + 2) return null;

    var rsiValues = calcRSI(closes, cfg.period);
    var lastIdx = closes.length - 1;
    var prevIdx = lastIdx - 1;

    var currRSI = rsiValues[lastIdx];
    var prevRSI = rsiValues[prevIdx];

    if (currRSI === null || prevRSI === null) return null;

    // Oversold => Buy signal
    if (prevRSI >= cfg.oversold && currRSI < cfg.oversold) {
      return {
        strategy: 'RSI超卖反弹',
        side: 'buy',
        strength: cfg.oversold - currRSI,
        meta: { rsi: +currRSI.toFixed(1), threshold: cfg.oversold }
      };
    }
    // Overbought => Sell signal
    if (prevRSI <= cfg.overbought && currRSI > cfg.overbought) {
      return {
        strategy: 'RSI超买回落',
        side: 'sell',
        strength: currRSI - cfg.overbought,
        meta: { rsi: +currRSI.toFixed(1), threshold: cfg.overbought }
      };
    }
    return null;
  }

  /** MACD Signal Strategy */
  function checkMACD(symbol, candles) {
    var cfg = getStrategyConfig(symbol, 'macd');
    var closes = candles.map(function(c) { return c.close; });
    if (closes.length < cfg.slowPeriod + cfg.signalPeriod + 1) return null;

    var macdResult = calcMACD(closes, cfg.fastPeriod, cfg.slowPeriod, cfg.signalPeriod);
    var lastIdx = closes.length - 1;
    var prevIdx = lastIdx - 1;

    if (macdResult.macdLine[lastIdx] === null || macdResult.signalLine[lastIdx] === null) return null;
    if (macdResult.macdLine[prevIdx] === null || macdResult.signalLine[prevIdx] === null) return null;

    var prevAbove = macdResult.macdLine[prevIdx] > macdResult.signalLine[prevIdx];
    var currAbove = macdResult.macdLine[lastIdx] > macdResult.signalLine[lastIdx];

    // MACD crosses above signal => Buy
    if (!prevAbove && currAbove) {
      return {
        strategy: 'MACD金叉',
        side: 'buy',
        strength: Math.abs(macdResult.histogram[lastIdx]),
        meta: { macd: +macdResult.macdLine[lastIdx].toFixed(4), signal: +macdResult.signalLine[lastIdx].toFixed(4), histogram: +macdResult.histogram[lastIdx].toFixed(4) }
      };
    }
    // MACD crosses below signal => Sell
    if (prevAbove && !currAbove) {
      return {
        strategy: 'MACD死叉',
        side: 'sell',
        strength: Math.abs(macdResult.histogram[lastIdx]),
        meta: { macd: +macdResult.macdLine[lastIdx].toFixed(4), signal: +macdResult.signalLine[lastIdx].toFixed(4), histogram: +macdResult.histogram[lastIdx].toFixed(4) }
      };
    }
    return null;
  }

  /** Bollinger Band Breakout Strategy */
  function checkBollinger(symbol, candles) {
    var cfg = getStrategyConfig(symbol, 'bollinger');
    var closes = candles.map(function(c) { return c.close; });
    if (closes.length < cfg.period + 1) return null;

    var bands = calcBollingerBands(closes, cfg.period, cfg.multiplier);
    var lastIdx = closes.length - 1;
    var prevIdx = lastIdx - 1;

    if (bands.lower[lastIdx] === null || bands.upper[lastIdx] === null) return null;

    var prevClose = closes[prevIdx];
    var currClose = closes[lastIdx];
    var prevLower = bands.lower[prevIdx];
    var currLower = bands.lower[lastIdx];
    var prevUpper = bands.upper[prevIdx];
    var currUpper = bands.upper[lastIdx];

    // Price crosses below lower band => Oversold bounce (Buy)
    if (prevClose >= prevLower && currClose < currLower) {
      return {
        strategy: '布林下轨反弹',
        side: 'buy',
        strength: ((currLower - currClose) / currLower) * 100,
        meta: { price: currClose, lower: +currLower.toFixed(2), upper: +currUpper.toFixed(2), middle: +bands.middle[lastIdx].toFixed(2) }
      };
    }
    // Price crosses above upper band => Overbought (Sell)
    if (prevClose <= prevUpper && currClose > currUpper) {
      return {
        strategy: '布林上轨突破',
        side: 'sell',
        strength: ((currClose - currUpper) / currUpper) * 100,
        meta: { price: currClose, lower: +currLower.toFixed(2), upper: +currUpper.toFixed(2), middle: +bands.middle[lastIdx].toFixed(2) }
      };
    }
    return null;
  }

  /** Grid Trading Strategy (网格交易) */
  function checkGrid(symbol, candles) {
    var cfg = getStrategyConfig(symbol, 'grid');
    if (candles.length === 0) return null;

    var price = candles[candles.length - 1].close;
    var gs = gridState[symbol];

    // Initialize grid if needed
    if (!gs) {
      gs = {
        basePrice: price,
        buyLevels: [],
        sellLevels: [],
        filledBuyLevels: {},
        filledSellLevels: {},
        gridSpacing: cfg.spacingPct,
        levels: cfg.levels
      };
      gridState[symbol] = gs;
      rebuildGridLevels(symbol);
      return null;
    }

    // Rebuild grid if price moved significantly from base
    var moveFromBase = Math.abs((price - gs.basePrice) / gs.basePrice) * 100;
    if (moveFromBase > gs.gridSpacing * gs.levels * 0.8) {
      gs.basePrice = price;
      rebuildGridLevels(symbol);
      return null;
    }

    // Check buy levels (price descending to a buy level)
    for (var i = gs.buyLevels.length - 1; i >= 0; i--) {
      var buyLevel = gs.buyLevels[i];
      var levelKey = buyLevel.toFixed(2);
      if (price <= buyLevel && !gs.filledBuyLevels[levelKey]) {
        gs.filledBuyLevels[levelKey] = Date.now();
        return {
          strategy: '网格买入 (Level ' + (i + 1) + ')',
          side: 'buy',
          strength: ((buyLevel - price) / buyLevel) * 100,
          meta: { gridLevel: i + 1, targetPrice: buyLevel, currentPrice: price }
        };
      }
    }

    // Check sell levels (price ascending to a sell level)
    for (var j = 0; j < gs.sellLevels.length; j++) {
      var sellLevel = gs.sellLevels[j];
      var sellKey = sellLevel.toFixed(2);
      if (price >= sellLevel && !gs.filledSellLevels[sellKey]) {
        gs.filledSellLevels[sellKey] = Date.now();
        return {
          strategy: '网格卖出 (Level ' + (j + 1) + ')',
          side: 'sell',
          strength: ((price - sellLevel) / sellLevel) * 100,
          meta: { gridLevel: j + 1, targetPrice: sellLevel, currentPrice: price }
        };
      }
    }

    return null;
  }

  function rebuildGridLevels(symbol) {
    var gs = gridState[symbol];
    if (!gs) return;
    var cfg = getStrategyConfig(symbol, 'grid');
    var base = gs.basePrice;

    gs.buyLevels = [];
    gs.sellLevels = [];
    gs.filledBuyLevels = {};
    gs.filledSellLevels = {};
    gs.gridSpacing = cfg.spacingPct;
    gs.levels = cfg.levels;

    for (var i = 1; i <= cfg.levels; i++) {
      var buyPrice = base * (1 - cfg.spacingPct / 100 * i);
      var sellPrice = base * (1 + cfg.spacingPct / 100 * i);
      gs.buyLevels.push(+buyPrice.toFixed(2));
      gs.sellLevels.push(+sellPrice.toFixed(2));
    }
  }

  // ============================================================
  //  HELPER: Get effective config for a symbol+strategy
  // ============================================================

  function getStrategyConfig(symbol, strategyKey) {
    // Symbol-specific override takes precedence
    if (strategyConfigs[symbol] && strategyConfigs[symbol][strategyKey]) {
      return Object.assign({}, globalConfig[strategyKey], strategyConfigs[symbol][strategyKey]);
    }
    return Object.assign({}, globalConfig[strategyKey]);
  }

  function isStrategyAllowedForSymbol(symbol, strategyKey) {
    var cfg = getStrategyConfig(symbol, strategyKey);
    if (!cfg.allowedSymbols || cfg.allowedSymbols.length === 0) return true;
    return cfg.allowedSymbols.indexOf(symbol) >= 0;
  }

  function isStrategyEnabledForSymbol(symbol, strategyKey) {
    if (!enabled) return false;
    if (!activeStrategies[symbol]) return false;
    if (!activeStrategies[symbol][strategyKey]) return false;
    var gCfg = globalConfig[strategyKey];
    if (!gCfg || !gCfg.enabled) return false;
    return isStrategyAllowedForSymbol(symbol, strategyKey);
  }

  // ============================================================
  //  SIGNAL EXECUTION
  // ============================================================

  /** Determine number of shares to trade based on signal */
  function calculateTradeSize(symbol, side, strategyKey) {
    var summary = Trader.getSummary();
    var totalAssets = summary.totalAssets;
    var cash = summary.cash;
    var price = Simulator.get(symbol).getPrice();
    var pos = getTraderPosition(symbol);

    if (side === 'buy') {
      // Use 10% of available cash per signal, minimum 1 lot
      var maxSpend = cash * 0.10;
      var shares = Math.floor(maxSpend / price / 100) * 100;
      if (shares < 100) shares = 100;

      // Check position limit
      var limitCheck = checkPositionLimit(symbol, shares);
      if (!limitCheck.allowed && limitCheck.maxAdditional < 100) {
        return 0;
      }
      if (!limitCheck.allowed) {
        shares = Math.floor(limitCheck.maxAdditional / 100) * 100;
      }

      // Check affordability
      var fee = Trader.calcFee('buy', price, shares);
      var totalCost = price * shares + fee.total;
      if (totalCost > cash) {
        shares = Math.floor((cash - fee.total) / price / 100) * 100;
      }

      return Math.max(0, Math.floor(shares / 100) * 100);
    }

    if (side === 'sell') {
      // Sell settled shares only (T+1 compliance)
      var settled = getSettledShares(symbol);
      if (settled < 100) return 0;

      // Sell 50% of settled position
      var sellShares = Math.floor(settled * 0.5 / 100) * 100;
      return Math.max(100, sellShares);
    }

    return 0;
  }

  /** Execute a trading signal with full policy compliance */
  function executeSignal(symbol, side, shares, strategy, price) {
    // 1. Validate shares (lot size)
    shares = Math.floor(shares / 100) * 100;
    if (shares < 100) {
      logTrade(symbol, side, 0, price, strategy, false, '最小交易单位100股');
      return { success: false, message: '最小交易单位100股' };
    }

    // 2. Circuit breaker check
    if (checkCircuitBreaker(symbol)) {
      logTrade(symbol, side, 0, price, strategy, false, '波动率异常，熔断机制生效');
      return { success: false, message: '波动率异常，暂停交易' };
    }

    // 3. Price limit check
    if (!isPriceWithinLimit(symbol, price)) {
      logTrade(symbol, side, 0, price, strategy, false, '超出涨跌停限制');
      return { success: false, message: '超出涨跌停限制' };
    }

    // 4. Daily trade limit
    var today = new Date().toDateString();
    if (today !== lastTradeDate) {
      dailyTradeCount = 0;
      lastTradeDate = today;
    }
    if (dailyTradeCount >= maxDailyTrades) {
      logTrade(symbol, side, 0, price, strategy, false, '达到每日最大交易次数(' + maxDailyTrades + ')');
      return { success: false, message: '达到每日最大交易次数' };
    }

    // 5. T+1: cannot sell today's purchases
    if (side === 'sell') {
      var settled = getSettledShares(symbol);
      if (settled < shares) {
        logTrade(symbol, side, 0, price, strategy, false, 'T+1限制：当日买入股票不可卖出，可用' + settled + '股');
        return { success: false, message: 'T+1限制：当日买入的股票不可卖出' };
      }
      // No short selling
      var pos = getTraderPosition(symbol);
      if (!pos || pos.shares < shares) {
        logTrade(symbol, side, 0, price, strategy, false, '持仓不足，A股不支持融券做空');
        return { success: false, message: '持仓不足，不支持做空' };
      }
    }

    // 6. Position limit check (buy only)
    if (side === 'buy') {
      var limitCheck = checkPositionLimit(symbol, shares);
      if (!limitCheck.allowed) {
        logTrade(symbol, side, 0, price, strategy, false, limitCheck.message);
        return { success: false, message: limitCheck.message };
      }
    }

    // 7. Execute trade
    var result = Trader.placeOrder(symbol, side, shares, {});
    dailyTradeCount++;

    if (result.success) {
      // Track T+1 unsettled shares
      if (side === 'buy') {
        if (!unsettledShares[symbol]) unsettledShares[symbol] = [];
        unsettledShares[symbol].push({
          shares: shares,
          buyDate: today,
          buyPrice: price
        });
      }
    }

    logTrade(symbol, side, shares, price, strategy, result.success, result.message);
    save();
    return result;
  }

  // ============================================================
  //  COOLDOWN CHECK
  // ============================================================

  var COOLDOWN_MS = 60000; // 60 seconds cooldown between signals of same type

  function isInCooldown(symbol, strategyKey) {
    var key = symbol + '_' + strategyKey;
    var last = signalCooldown[key];
    if (!last) return false;
    return (Date.now() - last) < COOLDOWN_MS;
  }

  function setCooldown(symbol, strategyKey) {
    signalCooldown[symbol + '_' + strategyKey] = Date.now();
  }

  // ============================================================
  //  MAIN TICK — called each candle from app.js
  // ============================================================

  function tick(stockData) {
    if (!enabled) return;

    var symbol = stockData.symbol;
    var candles = stockData.candles;
    if (!candles || candles.length < 20) return;

    var signals = [];

    // 1. MA Cross
    if (isStrategyEnabledForSymbol(symbol, 'maCross') && !isInCooldown(symbol, 'maCross')) {
      var maSig = checkMACross(symbol, candles);
      if (maSig) {
        setCooldown(symbol, 'maCross');
        signals.push(maSig);
      }
    }

    // 2. RSI Mean Reversion
    if (isStrategyEnabledForSymbol(symbol, 'rsi') && !isInCooldown(symbol, 'rsi')) {
      var rsiSig = checkRSI(symbol, candles);
      if (rsiSig) {
        setCooldown(symbol, 'rsi');
        signals.push(rsiSig);
      }
    }

    // 3. MACD Signal
    if (isStrategyEnabledForSymbol(symbol, 'macd') && !isInCooldown(symbol, 'macd')) {
      var macdSig = checkMACD(symbol, candles);
      if (macdSig) {
        setCooldown(symbol, 'macd');
        signals.push(macdSig);
      }
    }

    // 4. Bollinger Band Breakout
    if (isStrategyEnabledForSymbol(symbol, 'bollinger') && !isInCooldown(symbol, 'bollinger')) {
      var bollSig = checkBollinger(symbol, candles);
      if (bollSig) {
        setCooldown(symbol, 'bollinger');
        signals.push(bollSig);
      }
    }

    // 5. Grid Trading
    if (isStrategyEnabledForSymbol(symbol, 'grid') && !isInCooldown(symbol, 'grid')) {
      var gridSig = checkGrid(symbol, candles);
      if (gridSig) {
        setCooldown(symbol, 'grid');
        signals.push(gridSig);
      }
    }

    // Execute signals
    for (var i = 0; i < signals.length; i++) {
      var sig = signals[i];
      var price = candles[candles.length - 1].close;
      var shares = calculateTradeSize(symbol, sig.side, sig.strategy);
      if (shares >= 100) {
        executeSignal(symbol, sig.side, shares, sig.strategy, price);
      }
    }
  }

  // ============================================================
  //  TRADE LOG
  // ============================================================

  function logTrade(symbol, side, shares, price, strategy, success, message) {
    var entry = {
      time: Date.now(),
      symbol: symbol,
      side: side,
      shares: shares,
      price: price,
      strategy: strategy,
      success: success,
      message: message,
      name: Simulator.STOCKS[symbol] ? Simulator.STOCKS[symbol].name : symbol
    };
    tradeLog.unshift(entry);
    // Keep last 200 entries
    if (tradeLog.length > 200) tradeLog.length = 200;
  }

  function getTradeLog(limit) {
    limit = limit || 50;
    return tradeLog.slice(0, limit);
  }

  // ============================================================
  //  ENGINE CONTROL
  // ============================================================

  function start() {
    enabled = true;
    // Reset daily count if needed
    var today = new Date().toDateString();
    if (today !== lastTradeDate) {
      dailyTradeCount = 0;
      lastTradeDate = today;
    }
    save();
  }

  function stop() {
    enabled = false;
    save();
  }

  function toggle() {
    if (enabled) stop(); else start();
  }

  function isRunning() {
    return enabled;
  }

  function getStatus() {
    var today = new Date().toDateString();
    return {
      enabled: enabled,
      dailyTradeCount: dailyTradeCount,
      maxDailyTrades: maxDailyTrades,
      lastTradeDate: lastTradeDate,
      tradeLogCount: tradeLog.length,
      circuitBreakerActive: circuitBreakerActive,
      activeSymbols: Object.keys(activeStrategies).filter(function(sym) {
        var strats = activeStrategies[sym];
        for (var k in strats) { if (strats[k]) return true; }
        return false;
      }),
      strategyStatus: {
        maCross: globalConfig.maCross.enabled,
        rsi: globalConfig.rsi.enabled,
        macd: globalConfig.macd.enabled,
        bollinger: globalConfig.bollinger.enabled,
        grid: globalConfig.grid.enabled
      }
    };
  }

  // ============================================================
  //  CONFIGURATION
  // ============================================================

  /** Enable/disable a strategy globally */
  function setStrategyEnabled(strategyKey, enabledFlag) {
    if (globalConfig[strategyKey]) {
      globalConfig[strategyKey].enabled = enabledFlag;
      save();
    }
  }

  /** Update strategy parameters */
  function setStrategyConfig(strategyKey, params) {
    if (globalConfig[strategyKey]) {
      Object.assign(globalConfig[strategyKey], params);
      // Rebuild grids if needed
      if (strategyKey === 'grid') {
        Object.keys(gridState).forEach(function(sym) {
          rebuildGridLevels(sym);
        });
      }
      save();
    }
  }

  /** Get strategy config */
  function getGlobalConfig() {
    return JSON.parse(JSON.stringify(globalConfig));
  }

  /** Enable a strategy for a specific symbol */
  function setSymbolStrategy(symbol, strategyKey, enabledFlag) {
    if (!activeStrategies[symbol]) {
      activeStrategies[symbol] = {};
    }
    activeStrategies[symbol][strategyKey] = enabledFlag;

    // Initialize grid if needed
    if (strategyKey === 'grid' && enabledFlag && !gridState[symbol]) {
      var price = Simulator.get(symbol).getPrice();
      gridState[symbol] = {
        basePrice: price,
        buyLevels: [],
        sellLevels: [],
        filledBuyLevels: {},
        filledSellLevels: {},
        gridSpacing: globalConfig.grid.spacingPct,
        levels: globalConfig.grid.levels
      };
      rebuildGridLevels(symbol);
    }

    save();
  }

  /** Check if a strategy is active for a symbol */
  function isSymbolStrategyActive(symbol, strategyKey) {
    return activeStrategies[symbol] && activeStrategies[symbol][strategyKey];
  }

  /** Set allowed symbols for a strategy (empty array = all allowed) */
  function setAllowedSymbols(strategyKey, symbols) {
    if (globalConfig[strategyKey]) {
      globalConfig[strategyKey].allowedSymbols = symbols || [];
      save();
    }
  }

  /** Set max daily trades */
  function setMaxDailyTrades(max) {
    maxDailyTrades = Math.max(1, Math.min(200, max));
    save();
  }

  // ============================================================
  //  DAILY P&L SUMMARY
  // ============================================================

  function getDailyPnL() {
    var today = new Date().toDateString();
    var todayTrades = tradeLog.filter(function(t) {
      return new Date(t.time).toDateString() === today && t.success;
    });

    var buyTotal = 0, sellTotal = 0;
    var tradeCount = 0;

    for (var i = 0; i < todayTrades.length; i++) {
      var t = todayTrades[i];
      var value = t.price * t.shares;
      if (t.side === 'buy') buyTotal += value;
      else sellTotal += value;
      tradeCount++;
    }

    // Approximate P&L: cannot know exact since we track by trade not position matching
    // Use Trader's total P&L instead
    var summary = Trader.getSummary();

    return {
      date: today,
      tradeCount: tradeCount,
      buyTotal: +buyTotal.toFixed(2),
      sellTotal: +sellTotal.toFixed(2),
      totalPnL: summary.totalPnL,
      totalPnLPct: summary.totalPnLPct,
      autoTradeCount: todayTrades.length
    };
  }

  /** Reset grid state for all symbols */
  function resetGridState() {
    gridState = {};
  }

  /** Full reset */
  function reset() {
    enabled = false;
    activeStrategies = {};
    tradeLog = [];
    dailyTradeCount = 0;
    unsettledShares = {};
    gridState = {};
    signalCooldown = {};
    crossState = {};
    circuitBreakerActive = false;
    volatilityWarnings = {};
    save();
  }

  // ============================================================
  //  PERSISTENCE
  // ============================================================

  var STORAGE_KEY = 'kline_quant_log';

  function save() {
    try {
      var data = {
        enabled: enabled,
        activeStrategies: activeStrategies,
        globalConfig: globalConfig,
        tradeLog: tradeLog.slice(0, 200),
        dailyTradeCount: dailyTradeCount,
        lastTradeDate: lastTradeDate,
        maxDailyTrades: maxDailyTrades,
        gridState: gridState,
        unsettledShares: unsettledShares,
        savedAt: Date.now()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e) { /* quota exceeded */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      enabled = data.enabled || false;
      activeStrategies = data.activeStrategies || {};
      if (data.globalConfig) {
        Object.keys(data.globalConfig).forEach(function(k) {
          if (globalConfig[k]) {
            Object.assign(globalConfig[k], data.globalConfig[k]);
          }
        });
      }
      tradeLog = data.tradeLog || [];
      dailyTradeCount = data.dailyTradeCount || 0;
      lastTradeDate = data.lastTradeDate || '';
      maxDailyTrades = data.maxDailyTrades || 50;
      gridState = data.gridState || {};
      unsettledShares = data.unsettledShares || {};
      return true;
    } catch(e) { return false; }
  }

  // ============================================================
  //  PUBLIC API
  // ============================================================

  return {
    // Engine control
    start: start,
    stop: stop,
    toggle: toggle,
    isRunning: isRunning,
    tick: tick,
    getStatus: getStatus,
    reset: reset,

    // Trade log
    getTradeLog: getTradeLog,
    getDailyPnL: getDailyPnL,

    // Configuration
    getGlobalConfig: getGlobalConfig,
    setStrategyEnabled: setStrategyEnabled,
    setStrategyConfig: setStrategyConfig,
    setAllowedSymbols: setAllowedSymbols,
    setSymbolStrategy: setSymbolStrategy,
    isSymbolStrategyActive: isSymbolStrategyActive,
    setMaxDailyTrades: setMaxDailyTrades,

    // Policy compliance (exposed for UI)
    getSettledShares: getSettledShares,
    isPriceWithinLimit: isPriceWithinLimit,
    checkCircuitBreaker: checkCircuitBreaker,

    // Grid state (for UI)
    getGridState: function() { return gridState; },
    resetGridState: resetGridState,

    // Technical indicator access (for external use)
    calcSMA: calcSMA,
    calcEMA: calcEMA,
    calcRSI: calcRSI,
    calcMACD: calcMACD,
    calcBollingerBands: calcBollingerBands,

    // Persistence
    save: save,
    load: load,
    STORAGE_KEY: STORAGE_KEY
  };

})();
