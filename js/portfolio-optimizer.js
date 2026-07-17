/* ============================================
   portfolio-optimizer.js — 资产配置优化引擎
   Markowitz均值方差 · 有效前沿 · 风险平价 · 最优权重
   依赖 RiskMetrics 模块提供风险指标
   ============================================ */

const PortfolioOptimizer = (() => {

  // ── 数据准备 ──
  function getReturnsMatrix() {
    var stocks = Simulator.getAll();
    var allCandles = stocks.map(function(sim) { return sim.getCandles(); });
    var minLen = Math.min.apply(null, allCandles.map(function(c) { return c.length; }));
    if (minLen < 20) return null;

    var closes = stocks.map(function(sim, i) {
      return allCandles[i].slice(-minLen).map(function(c) { return c.close; });
    });

    // Log returns matrix [stocks × returns]
    var returns = [];
    for (var s = 0; s < closes.length; s++) {
      returns[s] = [];
      for (var t = 1; t < closes[s].length; t++) {
        returns[s].push(Math.log(closes[s][t] / closes[s][t - 1]));
      }
    }
    return { returns: returns, symbols: stocks.map(function(s, i) {
      return Object.keys(Simulator.STOCKS)[i];
    }), names: stocks.map(function(s, i) {
      var sym = Object.keys(Simulator.STOCKS)[i];
      return Simulator.STOCKS[sym] ? Simulator.STOCKS[sym].name : sym;
    }) };
  }

  // ── 均值向量 (年化) ──
  function meanVector(returnsMatrix) {
    return returnsMatrix.map(function(r) {
      var sum = r.reduce(function(a, b) { return a + b; }, 0);
      return (sum / r.length) * 252; // annualized
    });
  }

  // ── 协方差矩阵 (年化) ──
  function covMatrix(returnsMatrix) {
    var n = returnsMatrix.length;
    var T = returnsMatrix[0].length;
    var means = returnsMatrix.map(function(r) {
      return r.reduce(function(a, b) { return a + b; }, 0) / T;
    });

    var cov = [];
    for (var i = 0; i < n; i++) {
      cov[i] = [];
      for (var j = 0; j < n; j++) {
        var sum = 0;
        for (var t = 0; t < T; t++) {
          sum += (returnsMatrix[i][t] - means[i]) * (returnsMatrix[j][t] - means[j]);
        }
        cov[i][j] = (sum / (T - 1)) * 252; // annualized
      }
    }
    return cov;
  }

  // ── 组合统计 ──
  function portfolioReturn(weights, means) {
    var r = 0;
    for (var i = 0; i < weights.length; i++) r += weights[i] * means[i];
    return r;
  }

  function portfolioVariance(weights, cov) {
    var v = 0;
    for (var i = 0; i < weights.length; i++) {
      for (var j = 0; j < weights.length; j++) {
        v += weights[i] * weights[j] * cov[i][j];
      }
    }
    return v;
  }

  function portfolioSharpe(weights, means, cov, rf) {
    var rp = portfolioReturn(weights, means);
    var vp = portfolioVariance(weights, cov);
    if (vp <= 0) return 0;
    return (rp - (rf || 0.02)) / Math.sqrt(vp);
  }

  // ── 等权重 ──
  function equalWeight(n) {
    var w = [];
    for (var i = 0; i < n; i++) w.push(1 / n);
    return w;
  }

  // ── 最小方差组合 ──
  function minVariancePortfolio(cov) {
    var n = cov.length;
    // Simple quadratic: minimize w'Σw s.t. Σw_i = 1
    // Use Lagrange multiplier solution via matrix inversion
    var ones = [];
    for (var i = 0; i < n; i++) ones.push(1);

    var invCov = invertMatrix(cov);
    if (!invCov) return equalWeight(n);

    // w = Σ⁻¹·1 / (1'·Σ⁻¹·1)
    var numerator = multiplyMatrixVector(invCov, ones);
    var denom = 0;
    for (var i = 0; i < n; i++) denom += numerator[i];

    if (Math.abs(denom) < 1e-10) return equalWeight(n);
    return numerator.map(function(v) { return v / denom; });
  }

  // ── 最大夏普比率组合 ──
  function maxSharpePortfolio(means, cov, rf) {
    var n = means.length;
    var invCov = invertMatrix(cov);
    if (!invCov) return equalWeight(n);

    var excessReturns = means.map(function(m) { return m - (rf || 0.02); });
    var numerator = multiplyMatrixVector(invCov, excessReturns);
    var denom = 0;
    for (var i = 0; i < n; i++) denom += numerator[i];

    if (Math.abs(denom) < 1e-10) return minVariancePortfolio(cov);

    var w = numerator.map(function(v) { return v / denom; });
    // Clamp: no short selling (all weights >= 0)
    var clamped = w.map(function(v) { return Math.max(0, v); });
    var sum = clamped.reduce(function(a, b) { return a + b; }, 0);
    if (sum < 1e-10) return equalWeight(n);
    return clamped.map(function(v) { return v / sum; });
  }

  // ── 风险平价组合 ──
  function riskParityPortfolio(cov, maxIter) {
    var n = cov.length;
    maxIter = maxIter || 100;
    var w = equalWeight(n);

    for (var iter = 0; iter < maxIter; iter++) {
      // Marginal risk contribution: MRC_i = (Σw)_i / √(w'Σw)
      var portfolioStd = Math.sqrt(portfolioVariance(w, cov));
      if (portfolioStd < 1e-10) break;

      var mrc = [];
      for (var i = 0; i < n; i++) {
        var sum = 0;
        for (var j = 0; j < n; j++) sum += cov[i][j] * w[j];
        mrc.push(sum / portfolioStd);
      }

      // Risk contribution: RC_i = w_i × MRC_i
      var rc = [];
      for (var i = 0; i < n; i++) rc.push(w[i] * mrc[i]);
      var totalRC = rc.reduce(function(a, b) { return a + b; }, 0);

      // Target: equal RC = totalRC / n
      var target = totalRC / n;
      var maxDiff = 0;
      for (var i = 0; i < n; i++) {
        // Adjust: w_i *= target / RC_i (with dampening)
        if (rc[i] > 1e-10) {
          var adj = target / rc[i];
          w[i] = w[i] * (1 + 0.3 * (adj - 1)); // dampened
          if (w[i] < 0) w[i] = 0;
        }
        maxDiff = Math.max(maxDiff, Math.abs(rc[i] - target));
      }

      // Normalize
      var sumW = w.reduce(function(a, b) { return a + b; }, 0);
      for (var i = 0; i < n; i++) w[i] /= sumW;

      if (maxDiff < 0.01) break; // converged
    }

    // Filter: only keep stocks with weight > 1%
    var threshold = 0.01;
    var filtered = w.map(function(v) { return v >= threshold ? v : 0; });
    var fSum = filtered.reduce(function(a, b) { return a + b; }, 0);
    if (fSum < 1e-10) return w;
    return filtered.map(function(v) { return v / fSum; });
  }

  // ── 有效前沿 ──
  function efficientFrontier(means, cov, rf, points) {
    points = points || 20;
    var n = means.length;
    var minVarWeights = minVariancePortfolio(cov);
    var maxSRWeights = maxSharpePortfolio(means, cov, rf);

    var minVarRet = portfolioReturn(minVarWeights, means);
    var maxSRRet = portfolioReturn(maxSRWeights, means);
    var maxRet = Math.max.apply(null, means) * 0.8;

    var frontier = [];
    var retRange = Math.max(maxRet, maxSRRet * 1.5) - minVarRet;

    for (var i = 0; i <= points; i++) {
      var targetRet = minVarRet + retRange * (i / points);
      var w = optimizeForReturn(cov, means, targetRet);
      if (w) {
        frontier.push({
          return_: targetRet,
          risk: Math.sqrt(portfolioVariance(w, cov)),
          weights: w,
          sharpe: portfolioSharpe(w, means, cov, rf),
        });
      }
    }
    return frontier;
  }

  // ── 辅助：给定目标收益，最小化方差 ──
  function optimizeForReturn(cov, means, targetRet) {
    var n = cov.length;
    // Quadratic programming: min w'Σw s.t. w'μ = targetRet, Σw = 1, w >= 0
    // Simplified: grid search for 2-asset case, scaled identity for n>2
    // For practical purposes, use closed form without short-sale constraint first

    var invCov = invertMatrix(cov);
    if (!invCov) return null;

    var ones = [];
    for (var i = 0; i < n; i++) ones.push(1);

    // Closed form: w = Σ⁻¹·(λ₁·1 + λ₂·μ)
    // where λ₁, λ₂ solve: 1'w=1, μ'w=targetRet
    var A = dotProduct(multiplyMatrixVector(invCov, ones), ones);
    var B = dotProduct(multiplyMatrixVector(invCov, means), ones);
    var C = dotProduct(multiplyMatrixVector(invCov, ones), means);
    var D = dotProduct(multiplyMatrixVector(invCov, means), means);
    var det = A * D - B * C;

    if (Math.abs(det) < 1e-10) return null;

    var lambda1 = (D - C * targetRet) / det;
    var lambda2 = (A * targetRet - B) / det;

    var v1 = multiplyMatrixVector(invCov, ones);
    var v2 = multiplyMatrixVector(invCov, means);

    var w = [];
    for (var i = 0; i < n; i++) {
      w.push(lambda1 * v1[i] + lambda2 * v2[i]);
    }

    // Clamp negative weights to 0
    var clamped = w.map(function(v) { return Math.max(0, v); });
    var sum = clamped.reduce(function(a, b) { return a + b; }, 0);
    if (sum < 1e-10) return null;
    return clamped.map(function(v) { return v / sum; });
  }

  // ── 矩阵运算 ──
  function dotProduct(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  function multiplyMatrixVector(A, v) {
    var r = [];
    for (var i = 0; i < A.length; i++) {
      var s = 0;
      for (var j = 0; j < v.length; j++) s += A[i][j] * v[j];
      r.push(s);
    }
    return r;
  }

  function invertMatrix(A) {
    var n = A.length;
    // Augmented matrix [A|I]
    var aug = [];
    for (var i = 0; i < n; i++) {
      aug[i] = [];
      for (var j = 0; j < n; j++) aug[i][j] = A[i][j];
      for (var j = 0; j < n; j++) aug[i][n + j] = (i === j ? 1 : 0);
    }

    // Gauss-Jordan elimination
    for (var col = 0; col < n; col++) {
      // Find pivot
      var maxRow = col;
      for (var row = col + 1; row < n; row++) {
        if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
      }
      if (Math.abs(aug[maxRow][col]) < 1e-12) return null; // Singular

      // Swap
      var tmp = aug[col]; aug[col] = aug[maxRow]; aug[maxRow] = tmp;

      // Scale pivot row
      var pivot = aug[col][col];
      for (var j = 0; j < 2 * n; j++) aug[col][j] /= pivot;

      // Eliminate other rows
      for (var row = 0; row < n; row++) {
        if (row === col) continue;
        var factor = aug[row][col];
        for (var j = 0; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j];
      }
    }

    // Extract inverse
    var inv = [];
    for (var i = 0; i < n; i++) {
      inv[i] = [];
      for (var j = 0; j < n; j++) inv[i][j] = aug[i][n + j];
    }
    return inv;
  }

  // ── 全量分析 ──
  function optimize() {
    var data = getReturnsMatrix();
    if (!data) return { error: '数据不足，至少需要20根K线' };

    var means = meanVector(data.returns);
    var cov = covMatrix(data.returns);
    var rf = 0.02;

    var ew = equalWeight(data.returns.length);
    var minVar = minVariancePortfolio(cov);
    var maxSR = maxSharpePortfolio(means, cov, rf);
    var riskParity = riskParityPortfolio(cov);
    var frontier = efficientFrontier(means, cov, rf, 20);

    // Current weights from Trader positions
    var currentWeights = getCurrentWeights(data.symbols);

    return {
      symbols: data.symbols,
      names: data.names,
      means: means.map(function(v) { return +v.toFixed(4); }),
      cov: cov,
      allocations: {
        equalWeight: formatAlloc(data, ew),
        minVariance: formatAlloc(data, minVar),
        maxSharpe: formatAlloc(data, maxSR),
        riskParity: formatAlloc(data, riskParity),
        current: currentWeights,
      },
      efficientFrontier: frontier.map(function(p) {
        return { return_: +p.return_.toFixed(4), risk: +p.risk.toFixed(4), sharpe: +p.sharpe.toFixed(3) };
      }),
      stats: {
        equalWeight: computeStats(ew, means, cov, rf),
        minVariance: computeStats(minVar, means, cov, rf),
        maxSharpe: computeStats(maxSR, means, cov, rf),
        riskParity: computeStats(riskParity, means, cov, rf),
      },
    };
  }

  function formatAlloc(data, weights) {
    return data.symbols.map(function(sym, i) {
      return {
        symbol: sym,
        name: data.names[i],
        weight: +(weights[i] * 100).toFixed(1),
        expectedReturn: +(data.means ? 0 : 0),
      };
    }).filter(function(a) { return a.weight >= 0.5; })
      .sort(function(a, b) { return b.weight - a.weight; });
  }

  function computeStats(weights, means, cov, rf) {
    var ret = portfolioReturn(weights, means);
    var vol = Math.sqrt(portfolioVariance(weights, cov));
    var sharpe = (ret - (rf || 0.02)) / (vol || 0.01);
    return {
      expectedReturn: +ret.toFixed(4),
      volatility: +vol.toFixed(4),
      sharpeRatio: +sharpe.toFixed(3),
    };
  }

  function getCurrentWeights(symbols) {
    if (typeof Trader === 'undefined') return null;
    var totalAssets = Trader.getSummary().totalAssets || 100000;
    return symbols.map(function(sym) {
      var pos = Trader.getPositionInfo(sym);
      if (!pos) return { symbol: sym, weight: 0 };
      return { symbol: sym, name: Simulator.STOCKS[sym] ? Simulator.STOCKS[sym].name : sym, weight: +((pos.marketValue / totalAssets) * 100).toFixed(1) };
    }).sort(function(a, b) { return b.weight - a.weight; });
  }

  // ── 公开API ──
  return {
    optimize,
    equalWeight,
    minVariancePortfolio,
    maxSharpePortfolio,
    riskParityPortfolio,
    efficientFrontier,
    getReturnsMatrix,
    covMatrix,
    meanVector,
    computeStats,
  };
})();
