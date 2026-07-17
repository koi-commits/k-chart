/* ============================================
   volatility-updater.js — 真实波动率每日自动更新
   主源：新浪财经日K线API（国内可访问）
   备源：东方财富（部分网络可用）
   计算年化历史波动率，缓存至 localStorage
   ============================================ */

const VolatilityUpdater = (() => {

  const STORAGE_KEY = 'kline_volatility_data';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24小时缓存
  const LOOKBACK_DAYS = 60;  // 用近60个交易日计算波动率
  const TRADING_DAYS_PER_YEAR = 252;

  // ── 市场前缀 ──
  function getMarketPrefix(code) {
    if (code.startsWith('6') || code.startsWith('68')) return 'sh';  // 上证主板+科创板
    return 'sz';  // 深证（主板/创业板/中小板）
  }

  // ═══════════════════════════════════════════════
  // 主数据源：新浪财经
  // ═══════════════════════════════════════════════
  function buildSinaURL(code) {
    const prefix = getMarketPrefix(code);
    // scale=240 为日K线, datalen=60 取60根
    return 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/' +
      'CN_MarketData.getKLineData?symbol=' + prefix + code +
      '&scale=240&ma=no&datalen=' + LOOKBACK_DAYS;
  }

  /**
   * 解析新浪日K线响应
   * 格式: [{day, open, high, low, close, volume}, ...]
   */
  function parseSinaResponse(raw) {
    if (!raw || raw.trim() === 'null') return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length < 10) return null;
    return data;  // 返回原始对象数组
  }

  // ═══════════════════════════════════════════════
  // 备数据源：东方财富
  // ═══════════════════════════════════════════════
  function buildEastMoneyURL(code) {
    const prefix = code.startsWith('6') ? '1' : '0';
    return 'https://push2his.eastmoney.com/api/qt/stock/kline/get?' +
      'secid=' + prefix + '.' + code +
      '&fields1=f1,f2,f3,f4,f5,f6' +
      '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' +
      '&klt=101&fqt=1&end=20500101&lmt=' + LOOKBACK_DAYS;
  }

  /**
   * 解析东方财富日K线响应
   * 格式: {data: {klines: ["日期,开,收,高,低,量,额,...", ...]}}
   */
  function parseEastMoneyResponse(raw) {
    if (!raw) return null;
    const json = JSON.parse(raw);
    if (!json?.data?.klines || json.data.klines.length < 10) return null;
    // 转换为新浪格式的统一对象数组
    return json.data.klines.map(line => {
      const p = line.split(',');
      return {
        day: p[0],
        open: p[1],
        close: p[2],
        high: p[3],
        low: p[4],
        volume: p[5],
      };
    });
  }

  // ═══════════════════════════════════════════════
  // 波动率计算（统一处理新浪格式的对象数组）
  // ═══════════════════════════════════════════════
  /**
   * @param {Object[]} bars — [{day, open, high, low, close, volume}, ...]
   * @returns {{ annualVol, annualReturn, dailyStd, samples, period, latestClose } | null}
   */
  function calcHistoricalVol(bars) {
    if (!bars || bars.length < 10) return null;

    const closes = bars.map(b => parseFloat(b.close)).filter(p => !isNaN(p) && p > 0);
    if (closes.length < 10) return null;

    // 对数收益率: r_i = ln(P_i / P_{i-1})
    const logReturns = [];
    for (let i = 1; i < closes.length; i++) {
      logReturns.push(Math.log(closes[i] / closes[i - 1]));
    }
    if (logReturns.length < 5) return null;

    const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / logReturns.length;
    const dailyStd = Math.sqrt(variance);

    // 年化波动率: σ_annual = σ_daily × √252
    const annualVol = dailyStd * Math.sqrt(TRADING_DAYS_PER_YEAR);
    // 年化平均收益（供参考）
    const annualReturn = mean * TRADING_DAYS_PER_YEAR;

    const firstDate = bars[0].day;
    const lastDate = bars[bars.length - 1].day;

    return {
      annualVol: +annualVol.toFixed(4),
      annualReturn: +annualReturn.toFixed(4),
      dailyStd: +dailyStd.toFixed(6),
      samples: logReturns.length,
      period: firstDate + ' ~ ' + lastDate,
      latestClose: closes[closes.length - 1],
      source: 'sina',
    };
  }

  // ═══════════════════════════════════════════════
  // 数据抓取（主源 + 备源 fallback）
  // ═══════════════════════════════════════════════
  async function doFetch(url) {
    if (typeof window.marketAPI !== 'undefined') {
      return await window.marketAPI.fetch(url);
    }
    // 直接 fetch（开发模式）
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      return await resp.text();
    } catch (e) {
      return null;
    }
  }

  async function fetchStockVolatility(code) {
    // 1. 尝试新浪（主源）
    try {
      const raw = await doFetch(buildSinaURL(code));
      const bars = parseSinaResponse(raw);
      if (bars) {
        const result = calcHistoricalVol(bars);
        if (result) { result.source = 'sina'; return result; }
      }
    } catch (e) {
      console.warn('[VolUpdater] Sina failed for', code);
    }

    // 2. 尝试东方财富（备源）
    try {
      const raw = await doFetch(buildEastMoneyURL(code));
      const bars = parseEastMoneyResponse(raw);
      if (bars) {
        const result = calcHistoricalVol(bars);
        if (result) { result.source = 'eastmoney'; return result; }
      }
    } catch (e) {
      console.warn('[VolUpdater] EastMoney failed for', code);
    }

    return null;
  }

  // ═══════════════════════════════════════════════
  // 批量更新
  // ═══════════════════════════════════════════════
  async function updateAll() {
    const symbols = Object.keys(Simulator.STOCKS);
    const results = {};
    let successCount = 0;
    let failCount = 0;

    // 串行抓取避免同时过多请求被限流（16只股票，每个间隔200ms）
    for (const sym of symbols) {
      const result = await fetchStockVolatility(sym);
      // 小延迟避免请求过快
      await new Promise(r => setTimeout(r, 150));
      if (result) {
        results[sym] = result;
        successCount++;
      } else {
        failCount++;
      }
    }

    // 应用结果到 STOCKS
    for (const [sym, data] of Object.entries(results)) {
      if (Simulator.STOCKS[sym]) {
        Simulator.STOCKS[sym].annualVol = data.annualVol;
        Simulator.STOCKS[sym].latestClose = data.latestClose;
      }
    }

    // 保存缓存
    const cache = {
      updatedAt: Date.now(),
      updatedAtStr: new Date().toISOString(),
      data: results,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch (e) { /* ignore */ }

    return {
      success: successCount,
      failed: failCount,
      total: symbols.length,
      updatedAt: cache.updatedAtStr,
      details: results,
    };
  }

  // ═══════════════════════════════════════════════
  // 缓存管理
  // ═══════════════════════════════════════════════
  function getCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function isCacheExpired() {
    const cache = getCache();
    if (!cache?.updatedAt) return true;
    return (Date.now() - cache.updatedAt) > CACHE_TTL_MS;
  }

  function applyCache() {
    const cache = getCache();
    if (!cache?.data) return false;
    let applied = 0;
    for (const [sym, data] of Object.entries(cache.data)) {
      if (Simulator.STOCKS[sym] && data.annualVol) {
        Simulator.STOCKS[sym].annualVol = data.annualVol;
        Simulator.STOCKS[sym].latestClose = data.latestClose;
        applied++;
      }
    }
    return applied > 0;
  }

  async function init(onComplete) {
    const hasCache = applyCache();
    const expired = isCacheExpired();
    console.log('[VolUpdater] cache:', hasCache ? 'applied' : 'none', 'expired:', expired);

    if (expired || !hasCache) {
      console.log('[VolUpdater] fetching from Sina API...');
      const result = await updateAll();
      console.log('[VolUpdater] done:', result.success + '/' + result.total, 'via sina');
      if (onComplete) onComplete(result);
      return result;
    }

    if (onComplete) onComplete(null);
    return null;
  }

  async function forceRefresh(onComplete) {
    console.log('[VolUpdater] force refresh...');
    const result = await updateAll();
    if (onComplete) onComplete(result);
    return result;
  }

  // ═══════════════════════════════════════════════
  // 公开API
  // ═══════════════════════════════════════════════
  return {
    init,
    updateAll,
    forceRefresh,
    applyCache,
    getCache,
    isCacheExpired,
    fetchStockVolatility,
    calcHistoricalVol,
    getCacheAge: () => {
      const cache = getCache();
      if (!cache?.updatedAt) return Infinity;
      return Date.now() - cache.updatedAt;
    },
    getLastUpdateStr: () => {
      const cache = getCache();
      return cache?.updatedAtStr || '从未更新';
    },
  };
})();
