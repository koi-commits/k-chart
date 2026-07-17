/* ============================================
   simulator.js — GBM + EWMA 动态波动率 K线生成器
   基于专业金融模型：几何布朗运动 + 波动率聚类
   ============================================ */

const Simulator = (() => {

  // A股多板块代表（基于2025年真实市场数据校准）
  // annualVol: 年化波动率（源自近1年日收益率标准差年化）
  // trend: 年化趋势（正值看涨，负值看跌）
  // limitPct: 涨跌停幅度（主板10%，创业板/科创板20%）
  const STOCKS = {
    // ── 金融板块 ──
    '000001': { name: '平安银行',   basePrice: 12.50, annualVol: 0.19, trend: 0.08,  limitPct: 0.10, sector: '银行' },
    '601318': { name: '中国平安',   basePrice: 48.00, annualVol: 0.24, trend: 0.05,  limitPct: 0.10, sector: '保险' },
    '600030': { name: '中信证券',   basePrice: 22.00, annualVol: 0.35, trend: 0.15,  limitPct: 0.10, sector: '券商' },

    // ── 大消费板块 ──
    '600519': { name: '贵州茅台',   basePrice: 1680.00,annualVol: 0.28, trend: -0.12, limitPct: 0.10, sector: '白酒' },
    '600887': { name: '伊利股份',   basePrice: 28.00, annualVol: 0.22, trend: -0.03, limitPct: 0.10, sector: '消费' },
    '000333': { name: '美的集团',   basePrice: 65.00, annualVol: 0.20, trend: 0.10,  limitPct: 0.10, sector: '家电' },

    // ── 科技成长板块 ──
    '300750': { name: '宁德时代',   basePrice: 210.00,annualVol: 0.45, trend: 0.30,  limitPct: 0.20, sector: '新能源' },
    '688981': { name: '中芯国际',   basePrice: 52.00, annualVol: 0.58, trend: 0.40,  limitPct: 0.20, sector: '半导体' },
    '002230': { name: '科大讯飞',   basePrice: 45.00, annualVol: 0.52, trend: 0.35,  limitPct: 0.10, sector: 'AI科技' },
    '000063': { name: '中兴通讯',   basePrice: 32.00, annualVol: 0.44, trend: 0.20,  limitPct: 0.10, sector: '通信' },

    // ── 医药军工 ──
    '603259': { name: '药明康德',   basePrice: 55.00, annualVol: 0.48, trend: -0.18, limitPct: 0.10, sector: '医药' },
    '600760': { name: '中航沈飞',   basePrice: 48.00, annualVol: 0.42, trend: 0.25,  limitPct: 0.10, sector: '军工' },

    // ── 周期资源 ──
    '601899': { name: '紫金矿业',   basePrice: 18.00, annualVol: 0.38, trend: 0.22,  limitPct: 0.10, sector: '有色' },
    '600900': { name: '长江电力',   basePrice: 29.00, annualVol: 0.15, trend: 0.07,  limitPct: 0.10, sector: '电力' },

    // ── 地产汽车 ──
    '000002': { name: '万科A',      basePrice: 8.50,  annualVol: 0.32, trend: -0.25, limitPct: 0.10, sector: '地产' },
    '002594': { name: '比亚迪',     basePrice: 280.00,annualVol: 0.40, trend: 0.20,  limitPct: 0.10, sector: '汽车' },
  };

  // 兼容旧配置：将旧的 volatility 字段转换为 annualVol
  function normalizeConfig(cfg) {
    if (!cfg.annualVol && cfg.volatility) {
      // 旧 volatility 是每tick波动，转换为年化：σ_annual ≈ σ_tick * √(252*390)
      cfg.annualVol = cfg.volatility * Math.sqrt(252 * 390);
    }
    if (!cfg.limitPct) cfg.limitPct = 0.10;
    return cfg;
  }

  // K线周期（毫秒）
  const PERIOD_MS = {
    '1m':  60 * 1000,
    '5m':  5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h':  60 * 60 * 1000,
    '1d':  24 * 60 * 60 * 1000,
    '1w':  7 * 24 * 60 * 60 * 1000
  };

  // 年化时间单位：1分钟 = 1/(252*390) 年
  const DT_1MIN = 1 / (252 * 390);
  const MINUTES_PER_DAY = 390;  // A股交易日6.5小时=390分钟

  /**
   * Box-Muller: 标准正态分布 N(0,1)
   */
  function gaussianStd() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /**
   * 指数分布随机数（用于厚尾高低点生成）
   */
  function exponentialRandom(rate) {
    return -Math.log(Math.random()) / rate;
  }

  /**
   * EWMA 动态波动率估计器
   * 实现波动率聚类效应：大波动 → 波动率升高 → 持续一段时间 → 逐渐衰减
   */
  function createEWMA(lambda) {
    // RiskMetrics: λ=0.94 (日), 分钟级推荐 λ=0.995
    let variance = 0;
    let lastReturn = 0;
    let initialized = false;

    return {
      update(logReturn) {
        if (!initialized) {
          variance = logReturn * logReturn;
          initialized = true;
        } else {
          // σ²_t = λ·σ²_{t-1} + (1-λ)·r²_{t-1}
          variance = lambda * variance + (1 - lambda) * lastReturn * lastReturn;
        }
        lastReturn = logReturn;
        return Math.sqrt(variance);  // 返回当前估计的每tick标准差
      },
      getVariance() { return variance; },
      getSigma() { return Math.sqrt(variance); },
      reset() { variance = 0; lastReturn = 0; initialized = false; }
    };
  }

  /**
   * 创建单只股票的模拟器实例
   */
  function create(symbol) {
    const rawCfg = STOCKS[symbol] || STOCKS['000001'];
    const cfg = normalizeConfig(Object.assign({}, rawCfg));

    let price = cfg.basePrice;
    let candles = [];
    let aggregatedCandles = [];
    let currentPeriod = '15m';
    let listeners = [];
    let tickTime = Date.now() - 200 * 60 * 1000;

    // 涨跌停基准价：前一日收盘价
    let prevDayClose = cfg.basePrice;

    // EWMA 动态波动率（分钟级 λ=0.995）
    const ewma = createEWMA(0.995);

    // tick 计数器（用于日切换检测）
    let tickCount = 0;

    // 外部市场情绪波动率乘数
    let sentimentMult = 1.0;

    /**
     * GBM + EWMA 生成1分钟K线
     *
     * GBM:  S_t = S_{t-1} · exp( (μ - σ²/2)·dt + σ·√dt·Z )
     *   μ = 年化趋势 (如 0.05 = 5%年化收益)
     *   σ = 年化波动率 (来自 EWMA 动态调整)
     *   dt = 1分钟在年化尺度 = 1/(252·390)
     *   Z = 标准正态 N(0,1)
     */
    function generateTick() {
      tickTime += 60 * 1000;
      tickCount++;

      // 每日收盘时更新涨跌停基准价（每390分钟）
      if (tickCount > 0 && tickCount % MINUTES_PER_DAY === 0) {
        prevDayClose = price;
      }

      // --- 动态波动率 ---
      // 基础年化波动率 + EWMA缩放
      const baseAnnualVol = (STOCKS[symbol] && STOCKS[symbol].annualVol) || cfg.annualVol;
      const ewmaTickSigma = ewma.getSigma() || baseAnnualVol * Math.sqrt(DT_1MIN);
      // 将EWMA的tick级sigma转换为年化
      const ewmaAnnualVol = ewmaTickSigma / Math.sqrt(DT_1MIN);
      // 混合：70% EWMA动态 + 30% 长期均值（防止过度偏离）
      const effectiveAnnualVol = ewmaAnnualVol * 0.7 + baseAnnualVol * 0.3;
      // 限制波动率范围（年化5%~80%）
      let clampedAnnualVol = Math.max(0.05, Math.min(0.80, effectiveAnnualVol));

      // 外部情绪乘数（来自真实市场数据）
      if (typeof sentimentMult === 'number' && sentimentMult > 0) {
        clampedAnnualVol *= sentimentMult;
        clampedAnnualVol = Math.max(0.03, Math.min(1.50, clampedAnnualVol));
      }

      // --- GBM 价格更新 ---
      const mu = cfg.trend;  // 年化趋势
      const sigma = clampedAnnualVol;
      const sqrtDt = Math.sqrt(DT_1MIN);
      const Z = gaussianStd();

      // GBM 对数收益率
      const drift = (mu - 0.5 * sigma * sigma) * DT_1MIN;
      const diffusion = sigma * sqrtDt * Z;
      const logReturn = drift + diffusion;

      // 更新 EWMA（使用实际对数收益率，不含漂移）
      ewma.update(sigma * sqrtDt * Z);  // 只用随机冲击部分

      // --- 价格 ---
      const open = price;
      const close = price * Math.exp(logReturn);

      // --- 涨跌停限制（基于前一日收盘价） ---
      const limitUp = prevDayClose * (1 + cfg.limitPct);
      const limitDown = prevDayClose * (1 - cfg.limitPct);
      const clampedClose = Math.max(limitDown, Math.min(limitUp, close));

      // --- OHLC 构建（指数分布厚尾高低点） ---
      // 日内振幅基于波动率
      const intraVol = clampedAnnualVol * sqrtDt * 0.6;
      const highRange = intraVol * exponentialRandom(1.5);
      const lowRange = intraVol * exponentialRandom(1.5);

      const rawHigh = Math.max(open, clampedClose) * (1 + highRange);
      const rawLow = Math.min(open, clampedClose) * (1 - lowRange);
      const clampedHigh = Math.max(limitDown, Math.min(limitUp, rawHigh));
      const clampedLow = Math.max(limitDown, Math.min(limitUp, rawLow));

      // --- 成交量（量价关系） ---
      const baseVol = 50000 + Math.random() * 200000;
      const absReturn = Math.abs(logReturn);
      const volMultiplier = 1 + absReturn * 15;
      const volume = Math.floor(baseVol * volMultiplier);

      const candle = {
        time: tickTime,
        open:  +open.toFixed(2),
        high:  +clampedHigh.toFixed(2),
        low:   +clampedLow.toFixed(2),
        close: +clampedClose.toFixed(2),
        volume: volume
      };

      price = clampedClose;
      candles.push(candle);

      aggregateToPeriod();
      notify(candle);

      return candle;
    }

    /**
     * 将1分钟数据聚合到当前周期
     */
    function aggregateToPeriod() {
      const periodMs = PERIOD_MS[currentPeriod];
      if (candles.length === 0) return;

      const lastCandle = candles[candles.length - 1];
      const bucketTime = Math.floor(lastCandle.time / periodMs) * periodMs;

      const bucket = candles.filter(c =>
        Math.floor(c.time / periodMs) * periodMs === bucketTime
      );

      if (bucket.length === 0) return;

      const aggregated = {
        time: bucketTime,
        open:  bucket[0].open,
        high:  Math.max(...bucket.map(c => c.high)),
        low:   Math.min(...bucket.map(c => c.low)),
        close: bucket[bucket.length - 1].close,
        volume: bucket.reduce((sum, c) => sum + c.volume, 0)
      };

      const existingIdx = aggregatedCandles.findIndex(c => c.time === bucketTime);
      if (existingIdx >= 0) {
        aggregatedCandles[existingIdx] = aggregated;
      } else {
        aggregatedCandles.push(aggregated);
      }
    }

    /**
     * 切换周期时重新聚合全部数据
     */
    function rebuildAggregation(period) {
      currentPeriod = period;
      const periodMs = PERIOD_MS[period];
      aggregatedCandles = [];
      const buckets = new Map();

      for (const c of candles) {
        const bucketTime = Math.floor(c.time / periodMs) * periodMs;
        if (!buckets.has(bucketTime)) {
          buckets.set(bucketTime, []);
        }
        buckets.get(bucketTime).push(c);
      }

      for (const [time, bucket] of buckets) {
        aggregatedCandles.push({
          time: time,
          open:  bucket[0].open,
          high:  Math.max(...bucket.map(c => c.high)),
          low:   Math.min(...bucket.map(c => c.low)),
          close: bucket[bucket.length - 1].close,
          volume: bucket.reduce((sum, c) => sum + c.volume, 0)
        });
      }

      aggregatedCandles.sort((a, b) => a.time - b.time);
    }

    function switchPeriod(period) {
      rebuildAggregation(period);
    }

    function getCandles() {
      return aggregatedCandles;
    }

    function getLatestCandle() {
      return candles.length > 0 ? candles[candles.length - 1] : null;
    }

    function getPrice() {
      return price;
    }

    function getChange() {
      if (candles.length === 0) return { pct: 0, dir: 'flat' };
      const firstClose = candles[0].close;
      const pct = ((price - firstClose) / firstClose) * 100;
      return { pct: +pct.toFixed(2), dir: pct >= 0.01 ? 'up' : pct <= -0.01 ? 'down' : 'flat' };
    }

    function reset() {
      price = cfg.basePrice;
      candles = [];
      aggregatedCandles = [];
      tickTime = Date.now() - 200 * 60 * 1000;
      prevDayClose = cfg.basePrice;
      tickCount = 0;
      ewma.reset();
    }

    function onUpdate(fn) { listeners.push(fn); }
    function notify(candle) { listeners.forEach(fn => fn(candle)); }

    return {
      generateTick, switchPeriod, getCandles,
      getLatestCandle, getPrice, getChange, reset, onUpdate,
      setSentimentMultiplier: function(m) { sentimentMult = m; },
      getSentimentMultiplier: function() { return sentimentMult; }
    };
  }

  // 单例工厂
  const instances = {};

  function get(symbol) {
    if (!instances[symbol]) {
      instances[symbol] = create(symbol);
    }
    return instances[symbol];
  }

  function getAll() {
    return Object.keys(STOCKS).map(s => get(s));
  }

  /** 添加或更新股票 */
  function addStock(symbol, cfg) {
    STOCKS[symbol] = {
      name: cfg.name || symbol,
      basePrice: cfg.basePrice || 10,
      annualVol: cfg.annualVol || cfg.volatility || 0.25,
      trend: cfg.trend || 0.0001,
      limitPct: cfg.limitPct || 0.10,
      sector: cfg.sector || 'main'
    };
    if (instances[symbol]) {
      delete instances[symbol];
    }
    return STOCKS[symbol];
  }

  /** 删除股票 */
  function removeStock(symbol) {
    delete STOCKS[symbol];
    delete instances[symbol];
  }

  return { get, getAll, addStock, removeStock, STOCKS, PERIOD_MS };
})();
