/* ============================================
   risk-metrics.js — Risk Quantification Engine
   基于现代金融理论的量化风险指标计算
   Historical Vol, EWMA, Parkinson, Garman-Klass,
   VaR, CVaR, Drawdown, Sharpe, Sortino, Calmar,
   Beta, Correlation Matrix, Risk Decomposition
   ============================================ */

var RiskMetrics = (function() {

  // Constants
  var TRADING_DAYS = 252;
  var RISK_FREE_RATE = 0.02;  // 2% annual risk-free rate
  var MIN_CANDLES = 20;        // Minimum candles for meaningful computation
  var VAR_CONFIDENCE = [0.95, 0.99];

  // ========== Utility Functions ==========

  /**
   * Compute log returns from an array of close prices
   * r_t = ln(P_t / P_{t-1})
   */
  function computeLogReturns(closes) {
    var returns = [];
    for (var i = 1; i < closes.length; i++) {
      if (closes[i - 1] <= 0 || closes[i] <= 0) continue;
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
    return returns;
  }

  /**
   * Compute arithmetic returns from an array of close prices
   * r_t = (P_t - P_{t-1}) / P_{t-1}
   */
  function computeArithmeticReturns(closes) {
    var returns = [];
    for (var i = 1; i < closes.length; i++) {
      if (closes[i - 1] <= 0) continue;
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    return returns;
  }

  /**
   * Mean of an array
   */
  function mean(arr) {
    if (arr.length === 0) return 0;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  }

  /**
   * Sample standard deviation
   */
  function stdDev(arr) {
    if (arr.length < 2) return 0;
    var m = mean(arr);
    var sumSq = 0;
    for (var i = 0; i < arr.length; i++) sumSq += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(sumSq / (arr.length - 1));
  }

  /**
   * Population standard deviation
   */
  function stdDevPop(arr) {
    if (arr.length === 0) return 0;
    var m = mean(arr);
    var sumSq = 0;
    for (var i = 0; i < arr.length; i++) sumSq += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(sumSq / arr.length);
  }

  /**
   * Variance of an array
   */
  function variance(arr) {
    var s = stdDev(arr);
    return s * s;
  }

  /**
   * Covariance between two arrays
   */
  function covariance(x, y) {
    if (x.length !== y.length || x.length < 2) return 0;
    var mx = mean(x);
    var my = mean(y);
    var sum = 0;
    for (var i = 0; i < x.length; i++) {
      sum += (x[i] - mx) * (y[i] - my);
    }
    return sum / (x.length - 1);
  }

  /**
   * Percentile of sorted array (linear interpolation)
   */
  function percentile(arr, p) {
    if (arr.length === 0) return 0;
    var sorted = arr.slice().sort(function(a, b) { return a - b; });
    if (p <= 0) return sorted[0];
    if (p >= 1) return sorted[sorted.length - 1];
    var idx = p * (sorted.length - 1);
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  /**
   * Normal distribution CDF (Abramowitz & Stegun approximation)
   */
  function normCDF(x) {
    var t = 1 / (1 + 0.2316419 * Math.abs(x));
    var d = 0.3989423 * Math.exp(-x * x / 2);
    var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  }

  /**
   * Inverse normal CDF (Moro algorithm)
   */
  function normInvCDF(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    if (p === 0.5) return 0;

    var q = p < 0.5 ? p : 1 - p;
    if (q < 1e-20) return p < 0.5 ? -Infinity : Infinity;

    // Moro's algorithm
    var y = -Math.log(q * (2 - q) * 4);
    if (y > 6) {
      // Tail region
      var a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
      var b = [-8.47351093090, 23.08336743743, -21.06224101826, 3.13082909833];
      var c = [0.3374754822726147, 0.9761690190917186, 0.1607979714918209, 0.0276438810333863, 0.0038405729373609, 0.0003951896511919, 0.0000321767881768, 0.0000002888167364, 0.0000003960315187];
      var u = 0;
      for (var i = 0; i < a.length; i++) u += a[i] * Math.pow(y, -(i * 2 + 1));
      u /= y;
      var v = 0;
      for (var j = 0; j < b.length; j++) v += b[j] * Math.pow(y, -(j * 2 - 1));
      u /= v;
    } else {
      // Central region
      var a1 = [3.387132872796366, 133.1416678917844, 1971.590950306551, 13731.69376550946, 42921.30523337013, 45617.80865309842, -6764.86022512699, -11283.16812887493, -148.8618971513675, 1533.468758439622];
      var b1 = [1, 42.31333070160091, 687.1870074920199, 5394.196021424751, 21213.79430158660, 39307.89580009271, 28729.08573572194, 5226.495278852854];
      var u = 0;
      for (var k = 0; k < a1.length; k++) u += a1[k] * Math.pow(y, k);
      var v = 0;
      for (var l = 0; l < b1.length; l++) v += b1[l] * Math.pow(y, l);
      u /= v;
    }
    return p < 0.5 ? -u : u;
  }

  /**
   * Sorted absolute returns (for downside deviation)
   */
  function downsideDeviation(returns, targetReturn) {
    targetReturn = targetReturn || 0;
    var sumSq = 0;
    var count = 0;
    for (var i = 0; i < returns.length; i++) {
      if (returns[i] < targetReturn) {
        sumSq += (returns[i] - targetReturn) * (returns[i] - targetReturn);
        count++;
      }
    }
    if (count < 2) return 0;
    return Math.sqrt(sumSq / (count - 1));
  }

  /**
   * Extract close prices from candle array
   */
  function getCloses(candles) {
    var closes = [];
    for (var i = 0; i < candles.length; i++) {
      closes.push(candles[i].close);
    }
    return closes;
  }

  /**
   * Check minimum data requirement
   */
  function checkMinData(candles) {
    if (!candles || candles.length < MIN_CANDLES) {
      return { error: true, message: '数据不足（需要至少' + MIN_CANDLES + '根K线）' };
    }
    return { error: false };
  }

  // ========== 1. Volatility Metrics ==========

  /**
   * Historical Volatility (close-to-close)
   * σ_daily = std(log returns)
   * σ_annual = σ_daily * sqrt(252)
   */
  function getHistoricalVolatility(candles) {
    var check = checkMinData(candles);
    if (check.error) return null;

    var closes = getCloses(candles);
    var returns = computeLogReturns(closes);
    if (returns.length < 2) return null;

    var dailyVol = stdDev(returns);
    var annualVol = dailyVol * Math.sqrt(TRADING_DAYS);

    return {
      daily: dailyVol,
      annual: annualVol,
      annualPct: (annualVol * 100).toFixed(2)
    };
  }

  /**
   * EWMA Volatility (RiskMetrics lambda=0.94)
   * σ²_t = λ·σ²_{t-1} + (1-λ)·r²_{t-1}
   * Returns the latest annualized EWMA vol
   */
  function getEWMAVolatility(candles, lambda) {
    var check = checkMinData(candles);
    if (check.error) return null;

    lambda = lambda || 0.94;
    var closes = getCloses(candles);
    var returns = computeLogReturns(closes);
    if (returns.length < 2) return null;

    // Initialize with variance of first N returns
    var initCount = Math.min(20, returns.length);
    var initVariance = 0;
    for (var i = 0; i < initCount; i++) {
      initVariance += returns[i] * returns[i];
    }
    initVariance /= initCount;

    var ewmaVar = initVariance;
    var decayWeight = 1 - lambda;
    var prevReturn = returns[initCount - 1];

    for (var j = initCount; j < returns.length; j++) {
      var thisReturn = returns[j];
      // σ²_t = λ·σ²_{t-1} + (1-λ)·r²_t  (using current return)
      ewmaVar = lambda * ewmaVar + decayWeight * thisReturn * thisReturn;
      prevReturn = thisReturn;
    }

    var dailyVol = Math.sqrt(ewmaVar);
    var annualVol = dailyVol * Math.sqrt(TRADING_DAYS);

    return {
      daily: dailyVol,
      annual: annualVol,
      annualPct: (annualVol * 100).toFixed(2),
      lambda: lambda
    };
  }

  /**
   * Parkinson Volatility (Range-based)
   * σ = sqrt(1/(4n·ln2) * Σ(ln(H_i/L_i))²)
   * More efficient than close-to-close (5.2x efficiency gain)
   */
  function getParkinsonVolatility(candles) {
    var check = checkMinData(candles);
    if (check.error) return null;

    var sum = 0;
    var count = 0;
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      if (c.high > 0 && c.low > 0 && c.high >= c.low) {
        var hl = Math.log(c.high / c.low);
        sum += hl * hl;
        count++;
      }
    }
    if (count === 0) return null;

    // Parkinson estimator: σ² = 1/(4n·ln2) * Σ(ln(H/L))²
    var dailyVar = sum / (4 * count * Math.LN2);
    // This is the daily variance estimator
    var dailyVol = Math.sqrt(dailyVar);
    var annualVol = dailyVol * Math.sqrt(TRADING_DAYS);

    return {
      daily: dailyVol,
      annual: annualVol,
      annualPct: (annualVol * 100).toFixed(2),
      efficiencyGain: '5.2x vs close-to-close'
    };
  }

  /**
   * Garman-Klass Volatility (OHLC estimator)
   * σ² = 0.5·ln(H/L)² - (2·ln2 - 1)·ln(C/O)²
   * Most efficient (7.4x vs close-to-close)
   */
  function getGarmanKlassVolatility(candles) {
    var check = checkMinData(candles);
    if (check.error) return null;

    var sum = 0;
    var count = 0;
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      if (c.high > 0 && c.low > 0 && c.open > 0 && c.close > 0) {
        var hl = Math.log(c.high / c.low);
        var co = Math.log(c.close / c.open);
        // Garman-Klass: σ² = 0.5·(ln(H/L))² - (2·ln2 - 1)·(ln(C/O))²
        var gkVar = 0.5 * hl * hl - (2 * Math.LN2 - 1) * co * co;
        // Floor at 0
        if (gkVar > 0) {
          sum += gkVar;
          count++;
        }
      }
    }
    if (count === 0) return null;

    var dailyVar = sum / count;
    var dailyVol = Math.sqrt(dailyVar);
    var annualVol = dailyVol * Math.sqrt(TRADING_DAYS);

    return {
      daily: dailyVol,
      annual: annualVol,
      annualPct: (annualVol * 100).toFixed(2),
      efficiencyGain: '7.4x vs close-to-close'
    };
  }

  /**
   * All 4 volatility metrics
   */
  function getVolatility(symbol, candles) {
    var hv = getHistoricalVolatility(candles);
    var ewma = getEWMAVolatility(candles);
    var parkinson = getParkinsonVolatility(candles);
    var gk = getGarmanKlassVolatility(candles);

    return {
      historical: hv,
      ewma: ewma,
      parkinson: parkinson,
      garmanKlass: gk,
      primary: hv ? parseFloat(hv.annualPct) : null
    };
  }

  // ========== 2. Value at Risk (VaR) ==========

  /**
   * Historical VaR
   * VaR_α = -quantile(returns, 1-α)
   */
  function getHistoricalVaR(candles, confidence) {
    var check = checkMinData(candles);
    if (check.error) return null;

    confidence = confidence || 0.95;
    var closes = getCloses(candles);
    var returns = computeArithmeticReturns(closes);
    if (returns.length < 2) return null;

    var p = 1 - confidence;
    var varVal = -percentile(returns, p);

    return {
      value: varVal,
      confidence: confidence,
      label: (confidence * 100).toFixed(0) + '% VaR (历史模拟)',
      display: (varVal * 100).toFixed(2) + '%'
    };
  }

  /**
   * Parametric VaR (Normal distribution assumption)
   * VaR_α = -(μ + σ·z_α)
   */
  function getParametricVaR(candles, confidence) {
    var check = checkMinData(candles);
    if (check.error) return null;

    confidence = confidence || 0.95;
    var closes = getCloses(candles);
    var returns = computeLogReturns(closes);
    if (returns.length < 2) return null;

    var mu = mean(returns);
    var sigma = stdDev(returns);
    var z = normInvCDF(1 - confidence);  // z_α for VaR (negative)

    // VaR = -(μ + σ * z_α)
    // Since z_α is negative (e.g. -1.645 for 95%), this gives a positive loss
    var varLog = -(mu + sigma * z);
    // Convert from log return to arithmetic percentage
    var varPct = (1 - Math.exp(-varLog)) * 1;  // approximation: exp(-logVaR) gives the price ratio

    // Actually for small returns, arithmetic return ≈ log return
    // VaR in terms of price loss percentage
    var varArithmetic = 1 - Math.exp(-varLog);

    return {
      value: varArithmetic,
      confidence: confidence,
      label: (confidence * 100).toFixed(0) + '% VaR (参数法)',
      display: (varArithmetic * 100).toFixed(2) + '%'
    };
  }

  /**
   * Get VaR at multiple confidence levels
   */
  function getVaR(symbol, candles, confidence) {
    var confLevels = confidence ? [confidence] : VAR_CONFIDENCE;
    var result = {};

    for (var i = 0; i < confLevels.length; i++) {
      var cl = confLevels[i];
      var key = (cl * 100).toFixed(0) + '_pct';
      result[key] = {
        historical: getHistoricalVaR(candles, cl),
        parametric: getParametricVaR(candles, cl)
      };
    }

    return result;
  }

  // ========== 3. Conditional VaR (CVaR / Expected Shortfall) ==========

  /**
   * CVaR (Expected Shortfall)
   * CVaR_α = E[Loss | Loss > VaR_α]
   * "If things go really wrong, expected loss is X"
   */
  function getCVaR(candles, confidence) {
    var check = checkMinData(candles);
    if (check.error) return null;

    confidence = confidence || 0.95;
    var closes = getCloses(candles);
    var returns = computeArithmeticReturns(closes);
    if (returns.length < 2) return null;

    // Sort returns ascending (biggest loss first)
    var sorted = returns.slice().sort(function(a, b) { return a - b; });
    var p = 1 - confidence;
    var varIdx = Math.floor(p * sorted.length);
    var varVal = -sorted[varIdx];

    // CVaR = mean of all returns worse than VaR
    var sum = 0;
    var count = 0;
    for (var i = 0; i <= varIdx; i++) {
      sum += -sorted[i];
      count++;
    }

    var cvar = count > 0 ? sum / count : varVal;

    return {
      value: cvar,
      confidence: confidence,
      varValue: varVal,
      label: (confidence * 100).toFixed(0) + '% CVaR (条件风险价值)',
      display: (cvar * 100).toFixed(2) + '%',
      description: '在极端不利情况下（超过VaR），预期损失为' + (cvar * 100).toFixed(2) + '%'
    };
  }

  // ========== 4. Max Drawdown & Drawdown Analysis ==========

  /**
   * Max Drawdown analysis
   * Returns max drawdown %, duration, current drawdown, and underwater data
   */
  function getMaxDrawdown(candles) {
    var check = checkMinData(candles);
    if (check.error) return null;

    var closes = getCloses(candles);
    if (closes.length < 2) return null;

    var peak = closes[0];
    var maxDD = 0;
    var maxDDPeak = closes[0];
    var maxDDTrough = closes[0];
    var maxDDStartIdx = 0;
    var maxDDEndIdx = 0;
    var currentPeak = closes[0];
    var currentDD = 0;
    var underwaterData = [];  // [index, drawdown%] pairs

    for (var i = 0; i < closes.length; i++) {
      if (closes[i] > peak) {
        peak = closes[i];
      }
      var dd = (peak - closes[i]) / peak;
      underwaterData.push({ index: i, dd: dd, price: closes[i], peak: peak });

      if (dd > maxDD) {
        maxDD = dd;
        maxDDPeak = peak;
        maxDDTrough = closes[i];
        maxDDStartIdx = i;
      }

      // Track current drawdown
      if (closes[i] > currentPeak) {
        currentPeak = closes[i];
      }
      currentDD = (currentPeak - closes[closes.length - 1]) / currentPeak;
    }

    // Find end of max drawdown (when price recovers above peak)
    var recoveryIdx = -1;
    for (var j = maxDDStartIdx; j < closes.length; j++) {
      if (closes[j] >= maxDDPeak) {
        recoveryIdx = j;
        break;
      }
    }

    var duration = recoveryIdx > 0 ? recoveryIdx - maxDDStartIdx : closes.length - maxDDStartIdx;

    return {
      maxDrawdown: maxDD,
      maxDrawdownPct: (maxDD * 100).toFixed(2) + '%',
      maxDrawdownPeak: maxDDPeak,
      maxDrawdownTrough: maxDDTrough,
      duration: duration,
      recovered: recoveryIdx > 0,
      currentDrawdown: currentDD,
      currentDrawdownPct: (currentDD * 100).toFixed(2) + '%',
      underwater: underwaterData
    };
  }

  // ========== 5. Performance Ratios ==========

  /**
   * Sharpe Ratio
   * (R_p - R_f) / σ_p
   */
  function getSharpeRatio(candles) {
    var check = checkMinData(candles);
    if (check.error) return null;

    var closes = getCloses(candles);
    var returns = computeLogReturns(closes);
    if (returns.length < 2) return null;

    var avgDailyReturn = mean(returns);
    var annualReturn = avgDailyReturn * TRADING_DAYS;
    var annualVol = stdDev(returns) * Math.sqrt(TRADING_DAYS);

    if (annualVol === 0) return null;

    var sharpe = (annualReturn - RISK_FREE_RATE) / annualVol;

    return {
      value: sharpe,
      display: sharpe.toFixed(3),
      annualReturn: annualReturn,
      annualReturnPct: (annualReturn * 100).toFixed(2) + '%',
      annualVol: annualVol,
      annualVolPct: (annualVol * 100).toFixed(2) + '%',
      riskFreeRate: RISK_FREE_RATE,
      interpretation: sharpe < 0 ? '负值（收益低于无风险利率）' :
                     sharpe < 0.5 ? '较差' :
                     sharpe < 1.0 ? '一般' :
                     sharpe < 2.0 ? '良好' :
                     sharpe < 3.0 ? '优秀' : '卓越'
    };
  }

  /**
   * Sortino Ratio
   * (R_p - R_f) / σ_downside
   * Only penalizes downside volatility
   */
  function getSortinoRatio(candles) {
    var check = checkMinData(candles);
    if (check.error) return null;

    var closes = getCloses(candles);
    var returns = computeLogReturns(closes);
    if (returns.length < 2) return null;

    var avgDailyReturn = mean(returns);
    var annualReturn = avgDailyReturn * TRADING_DAYS;

    // Daily risk-free rate
    var dailyRf = RISK_FREE_RATE / TRADING_DAYS;
    var downDev = downsideDeviation(returns, dailyRf);
    var annualDownDev = downDev * Math.sqrt(TRADING_DAYS);

    if (annualDownDev === 0) return null;

    var sortino = (annualReturn - RISK_FREE_RATE) / annualDownDev;

    return {
      value: sortino,
      display: sortino.toFixed(3),
      annualDownsideVol: annualDownDev,
      annualDownsideVolPct: (annualDownDev * 100).toFixed(2) + '%',
      interpretation: sortino < 0 ? '负值' :
                     sortino < 0.5 ? '较差' :
                     sortino < 1.0 ? '一般' :
                     sortino < 2.0 ? '良好' :
                     sortino < 3.0 ? '优秀' : '卓越'
    };
  }

  /**
   * Calmar Ratio
   * Annualized Return / |Max Drawdown|
   */
  function getCalmarRatio(candles) {
    var check = checkMinData(candles);
    if (check.error) return null;

    var closes = getCloses(candles);
    var returns = computeLogReturns(closes);
    var dd = getMaxDrawdown(candles);

    if (!dd || dd.maxDrawdown === 0) return null;

    var avgDailyReturn = mean(returns);
    var annualReturn = avgDailyReturn * TRADING_DAYS;
    var calmar = annualReturn / Math.abs(dd.maxDrawdown);

    return {
      value: calmar,
      display: calmar.toFixed(3),
      maxDrawdown: dd.maxDrawdown,
      maxDrawdownPct: dd.maxDrawdownPct,
      interpretation: calmar < 0 ? '负值（策略亏损）' :
                     calmar < 0.5 ? '较差' :
                     calmar < 1.0 ? '一般' :
                     calmar < 2.0 ? '良好' : '优秀'
    };
  }

  /**
   * Treynor Ratio
   * (R_p - R_f) / β_p
   */
  function getTreynorRatio(candles, beta) {
    var check = checkMinData(candles);
    if (check.error) return null;

    if (beta === null || beta === undefined || beta === 0) return null;

    var closes = getCloses(candles);
    var returns = computeLogReturns(closes);
    if (returns.length < 2) return null;

    var avgDailyReturn = mean(returns);
    var annualReturn = avgDailyReturn * TRADING_DAYS;
    var treynor = (annualReturn - RISK_FREE_RATE) / beta;

    return {
      value: treynor,
      display: treynor.toFixed(3),
      beta: beta,
      interpretation: treynor < 0 ? '负值（收益低于无风险利率）' :
                     treynor < 0.1 ? '较差' :
                     treynor < 0.3 ? '一般' :
                     treynor < 0.5 ? '良好' : '优秀'
    };
  }

  /**
   * Information Ratio
   * (R_p - R_benchmark) / tracking_error
   */
  function getInformationRatio(candles, benchmarkReturns) {
    var check = checkMinData(candles);
    if (check.error) return null;

    var closes = getCloses(candles);
    var returns = computeLogReturns(closes);
    if (returns.length < 2 || !benchmarkReturns || benchmarkReturns.length < returns.length) return null;

    // Align lengths
    var offset = benchmarkReturns.length - returns.length;
    if (offset < 0) return null;

    var excessReturns = [];
    for (var i = 0; i < returns.length; i++) {
      excessReturns.push(returns[i] - benchmarkReturns[offset + i]);
    }

    var trackingError = stdDev(excessReturns) * Math.sqrt(TRADING_DAYS);
    var avgExcess = mean(excessReturns) * TRADING_DAYS;

    if (trackingError === 0) return null;

    var ir = avgExcess / trackingError;

    return {
      value: ir,
      display: ir.toFixed(3),
      trackingError: trackingError,
      trackingErrorPct: (trackingError * 100).toFixed(2) + '%',
      annualExcessReturn: avgExcess,
      annualExcessReturnPct: (avgExcess * 100).toFixed(2) + '%',
      interpretation: ir < 0 ? '负值（跑输基准）' :
                     ir < 0.5 ? '一般' :
                     ir < 1.0 ? '良好' :
                     ir < 1.5 ? '优秀' : '卓越'
    };
  }

  /**
   * Omega Ratio
   * probability-weighted ratio of gains vs losses
   * Omega(L) = E[Max(R - L, 0)] / E[Max(L - R, 0)]
   */
  function getOmegaRatio(candles, threshold) {
    var check = checkMinData(candles);
    if (check.error) return null;

    threshold = threshold || RISK_FREE_RATE / TRADING_DAYS;  // daily risk-free as threshold

    var closes = getCloses(candles);
    var returns = computeArithmeticReturns(closes);
    if (returns.length < 2) return null;

    var gainSum = 0;
    var lossSum = 0;
    for (var i = 0; i < returns.length; i++) {
      if (returns[i] > threshold) {
        gainSum += (returns[i] - threshold);
      } else {
        lossSum += (threshold - returns[i]);
      }
    }

    var omega = lossSum > 0 ? gainSum / lossSum : (gainSum > 0 ? Infinity : 1);

    return {
      value: omega,
      display: isFinite(omega) ? omega.toFixed(3) : 'Inf',
      threshold: threshold,
      thresholdAnnualPct: (threshold * TRADING_DAYS * 100).toFixed(2) + '%',
      interpretation: omega < 1 ? '收益低于阈值' :
                     omega < 1.5 ? '一般' :
                     omega < 2.0 ? '良好' :
                     omega < 3.0 ? '优秀' : '卓越'
    };
  }

  // ========== 6. Correlation & Beta ==========

  /**
   * Compute market returns: equal-weighted average of all 16 stock returns
   */
  function computeMarketReturns(stocksData) {
    // stocksData is array of [symbol, candles] pairs or Simulator instances with getCandles()
    if (!stocksData || stocksData.length === 0) return null;

    // Get returns for each stock
    var allReturns = [];
    var maxLen = 0;

    for (var i = 0; i < stocksData.length; i++) {
      var candles;
      if (typeof stocksData[i].getCandles === 'function') {
        candles = stocksData[i].getCandles();
      } else {
        candles = stocksData[i];
      }

      var closes = getCloses(candles);
      var returns = computeLogReturns(closes);
      if (returns.length > maxLen) maxLen = returns.length;
      allReturns.push(returns);
    }

    if (allReturns.length === 0 || maxLen < 2) return null;

    // Equal-weighted average across stocks, aligned by latest data
    var marketReturns = [];
    for (var t = 0; t < maxLen; t++) {
      var sum = 0;
      var count = 0;
      for (var s = 0; s < allReturns.length; s++) {
        var r = allReturns[s];
        var idx = r.length - maxLen + t;  // Align from the end
        if (idx >= 0 && idx < r.length) {
          sum += r[idx];
          count++;
        }
      }
      marketReturns.push(count > 0 ? sum / count : 0);
    }

    return marketReturns;
  }

  /**
   * Beta to market
   * β = Cov(stock, market) / Var(market)
   */
  function getBeta(symbol, candles, marketReturns) {
    var check = checkMinData(candles);
    if (check.error) return null;

    var closes = getCloses(candles);
    var stockReturns = computeLogReturns(closes);
    if (stockReturns.length < 2 || !marketReturns || marketReturns.length < 2) return null;

    // Align lengths (match from the end)
    var len = Math.min(stockReturns.length, marketReturns.length);
    var alignedStock = stockReturns.slice(stockReturns.length - len);
    var alignedMarket = marketReturns.slice(marketReturns.length - len);

    if (alignedStock.length < 2) return null;

    var mktVar = variance(alignedMarket);
    if (mktVar === 0) return null;

    var cov = covariance(alignedStock, alignedMarket);
    var beta = cov / mktVar;

    // R-squared (goodness of fit)
    var stockVar = variance(alignedStock);
    var rSquared = stockVar > 0 ? (beta * beta * mktVar) / stockVar : 0;

    // Correlation coefficient
    var stockStd = Math.sqrt(stockVar);
    var mktStd = Math.sqrt(mktVar);
    var corr = stockStd > 0 && mktStd > 0 ? cov / (stockStd * mktStd) : 0;

    return {
      beta: beta,
      display: beta.toFixed(3),
      rSquared: rSquared,
      rSquaredDisplay: rSquared.toFixed(4),
      correlation: corr,
      correlationDisplay: corr.toFixed(4),
      interpretation: beta < 0 ? '反向波动' :
                     beta < 0.5 ? '低波动（防御型）' :
                     beta < 0.8 ? '较低波动' :
                     beta < 1.2 ? '与市场同步' :
                     beta < 2.0 ? '较高波动（进攻型）' : '高波动（激进型）'
    };
  }

  /**
   * Correlation Matrix between all stocks
   * Returns matrix as [symbols[], [row[]]] and heatmap data
   */
  function getCorrelationMatrix(allStocksData) {
    // allStocksData can be:
    // 1. Array of Simulator instances (with getCandles())
    // 2. Array of {symbol, candles} objects
    if (!allStocksData || allStocksData.length < 2) return null;

    var symbols = [];
    var returnSeries = [];

    for (var i = 0; i < allStocksData.length; i++) {
      var item = allStocksData[i];
      var candles, sym;
      if (typeof item.getCandles === 'function') {
        var sim = item;
        candles = sim.getCandles();
        // Extract symbol from simulator - need to look it up
        var allSymbols = Object.keys(Simulator.STOCKS);
        for (var k = 0; k < allSymbols.length; k++) {
          if (Simulator.get(allSymbols[k]) === sim) {
            sym = allSymbols[k];
            break;
          }
        }
      } else if (item.candles) {
        candles = item.candles;
        sym = item.symbol;
      }

      if (!candles || candles.length < MIN_CANDLES) continue;
      var closes = getCloses(candles);
      var returns = computeLogReturns(closes);
      if (returns.length < 2) continue;

      symbols.push(sym || ('Stock' + i));
      returnSeries.push(returns);
    }

    if (symbols.length < 2) return null;

    // Build correlation matrix
    var n = symbols.length;
    var matrix = [];
    var maxLen = 0;
    for (var s = 0; s < n; s++) {
      if (returnSeries[s].length > maxLen) maxLen = returnSeries[s].length;
    }

    for (var row = 0; row < n; row++) {
      matrix[row] = [];
      for (var col = 0; col < n; col++) {
        if (row === col) {
          matrix[row][col] = 1.0;
        } else {
          // Align return series
          var r1 = returnSeries[row];
          var r2 = returnSeries[col];
          var len = Math.min(r1.length, r2.length);
          var a1 = r1.slice(r1.length - len);
          var a2 = r2.slice(r2.length - len);

          var cov = covariance(a1, a2);
          var std1 = stdDev(a1);
          var std2 = stdDev(a2);
          matrix[row][col] = (std1 > 0 && std2 > 0) ? cov / (std1 * std2) : 0;
        }
      }
    }

    return {
      symbols: symbols,
      matrix: matrix,
      n: n
    };
  }

  // ========== 7. Risk Decomposition ==========

  /**
   * Decompose total risk into systematic and unsystematic
   * Systematic risk (market): σ_sys = |β| × σ_market
   * Unsystematic risk (stock-specific): σ_unsys = sqrt(σ²_total - σ²_sys)
   * Diversification ratio = unsystematic / total
   */
  function getRiskDecomposition(symbol, candles, marketReturns) {
    var check = checkMinData(candles);
    if (check.error) return null;

    var closes = getCloses(candles);
    var stockReturns = computeLogReturns(closes);
    if (stockReturns.length < 2 || !marketReturns || marketReturns.length < 2) return null;

    var betaResult = getBeta(symbol, candles, marketReturns);
    if (!betaResult) return null;

    var beta = betaResult.beta;
    var rSquared = betaResult.rSquared;

    // Total annualized volatility
    var stockDailyVol = stdDev(stockReturns);
    var totalVolAnnual = stockDailyVol * Math.sqrt(TRADING_DAYS);

    // Market annualized volatility
    var mktDailyVol = stdDev(marketReturns);
    var mktVolAnnual = mktDailyVol * Math.sqrt(TRADING_DAYS);

    // Systematic risk
    var systematicVol = Math.abs(beta) * mktVolAnnual;

    // Unsystematic risk
    var systematicVar = systematicVol * systematicVol;
    var totalVar = totalVolAnnual * totalVolAnnual;
    var unsystematicVol = Math.sqrt(Math.max(0, totalVar - systematicVar));

    // Diversification ratio
    var divRatio = totalVolAnnual > 0 ? unsystematicVol / totalVolAnnual : 0;

    // Systematic risk as percentage of total
    var sysPct = totalVar > 0 ? (systematicVar / totalVar) * 100 : 0;
    var unsysPct = 100 - sysPct;

    return {
      totalVolAnnual: totalVolAnnual,
      totalVolAnnualPct: (totalVolAnnual * 100).toFixed(2) + '%',
      systematicVol: systematicVol,
      systematicVolPct: (systematicVol * 100).toFixed(2) + '%',
      unsystematicVol: unsystematicVol,
      unsystematicVolPct: (unsystematicVol * 100).toFixed(2) + '%',
      systematicRiskPct: sysPct.toFixed(1) + '%',
      unsystematicRiskPct: unsysPct.toFixed(1) + '%',
      diversificationRatio: divRatio,
      diversificationRatioDisplay: (divRatio * 100).toFixed(1) + '%',
      beta: beta,
      rSquared: rSquared,
      marketVol: mktVolAnnual,
      marketVolPct: (mktVolAnnual * 100).toFixed(2) + '%'
    };
  }

  // ========== 8. Overall Risk Score ==========

  /**
   * Compute an overall risk score from 0-100
   * Based on volatility, VaR, drawdown, and Sharpe ratio
   * 0 = minimum risk, 100 = maximum risk
   */
  function getRiskScore(candles, marketReturns) {
    var check = checkMinData(candles);
    if (check.error) return null;

    var vol = getHistoricalVolatility(candles);
    var dd = getMaxDrawdown(candles);
    var sharpe = getSharpeRatio(candles);
    var betaResult = marketReturns ? getBeta(null, candles, marketReturns) : null;

    if (!vol || !dd) return null;

    // Component scores (0-100, higher = more risk)
    // Volatility: 0-80% annual maps to 0-100
    var volScore = Math.min(100, (vol.annual / 0.80) * 100);

    // Max drawdown: 0-80% maps to 0-100
    var ddScore = Math.min(100, (dd.maxDrawdown / 0.80) * 100);

    // Sharpe: -2 to 3 maps to 100-0 (higher sharpe = lower risk)
    var sharpeScore = 50;
    if (sharpe) {
      sharpeScore = Math.max(0, Math.min(100, 50 - sharpe.value * 25));
    }

    // Beta: 0-3 maps to 0-100 (higher beta = higher risk)
    var betaScore = 50;
    if (betaResult && betaResult.beta !== null) {
      betaScore = Math.max(0, Math.min(100, Math.abs(betaResult.beta) / 3 * 100));
    }

    // Weighted composite
    var score = volScore * 0.3 + ddScore * 0.3 + sharpeScore * 0.25 + betaScore * 0.15;

    var level = score < 25 ? '低风险' :
                score < 45 ? '中低风险' :
                score < 60 ? '中等风险' :
                score < 75 ? '中高风险' : '高风险';

    var color = score < 25 ? '#66bb6a' :
                score < 45 ? '#aed581' :
                score < 60 ? '#ffd54f' :
                score < 75 ? '#ff9800' : '#ff5252';

    return {
      score: Math.round(score),
      level: level,
      color: color,
      volatilityScore: Math.round(volScore),
      drawdownScore: Math.round(ddScore),
      sharpeScore: Math.round(sharpeScore),
      betaScore: Math.round(betaScore)
    };
  }

  // ========== 9. Compute All ==========

  function computeAll(symbol, candles, marketReturns) {
    var check = checkMinData(candles);
    if (check.error) return { error: true, message: check.message };

    // Compute all metrics
    var volatility = getVolatility(symbol, candles);
    var varResult = getVaR(symbol, candles);
    var cvar95 = getCVaR(candles, 0.95);
    var cvar99 = getCVaR(candles, 0.99);
    var drawdown = getMaxDrawdown(candles);
    var sharpe = getSharpeRatio(candles);
    var sortino = getSortinoRatio(candles);
    var calmar = getCalmarRatio(candles);
    var omega = getOmegaRatio(candles);

    var betaResult = marketReturns ? getBeta(symbol, candles, marketReturns) : null;
    var treynor = betaResult ? getTreynorRatio(candles, betaResult.beta) : null;
    var infoRatio = marketReturns ? getInformationRatio(candles, marketReturns) : null;
    var riskDecomp = marketReturns ? getRiskDecomposition(symbol, candles, marketReturns) : null;
    var riskScore = getRiskScore(candles, marketReturns);

    return {
      symbol: symbol,
      volatility: volatility,
      var: varResult,
      cvar95: cvar95,
      cvar99: cvar99,
      drawdown: drawdown,
      sharpe: sharpe,
      sortino: sortino,
      calmar: calmar,
      omega: omega,
      beta: betaResult,
      treynor: treynor,
      informationRatio: infoRatio,
      riskDecomposition: riskDecomp,
      riskScore: riskScore,
      error: false
    };
  }

  // ========== Public API ==========
  return {
    computeAll: computeAll,
    getVolatility: getVolatility,
    getHistoricalVolatility: getHistoricalVolatility,
    getEWMAVolatility: getEWMAVolatility,
    getParkinsonVolatility: getParkinsonVolatility,
    getGarmanKlassVolatility: getGarmanKlassVolatility,
    getVaR: getVaR,
    getHistoricalVaR: getHistoricalVaR,
    getParametricVaR: getParametricVaR,
    getCVaR: getCVaR,
    getMaxDrawdown: getMaxDrawdown,
    getSharpeRatio: getSharpeRatio,
    getSortinoRatio: getSortinoRatio,
    getCalmarRatio: getCalmarRatio,
    getTreynorRatio: getTreynorRatio,
    getInformationRatio: getInformationRatio,
    getOmegaRatio: getOmegaRatio,
    getBeta: getBeta,
    getCorrelationMatrix: getCorrelationMatrix,
    getRiskDecomposition: getRiskDecomposition,
    getRiskScore: getRiskScore,
    computeMarketReturns: computeMarketReturns,
    TRADING_DAYS: TRADING_DAYS,
    RISK_FREE_RATE: RISK_FREE_RATE,
    MIN_CANDLES: MIN_CANDLES
  };
})();
