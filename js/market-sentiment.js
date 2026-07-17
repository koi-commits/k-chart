/* ============================================
   market-sentiment.js — 实时市场情绪指数
   从东方财富/新浪/腾讯公开接口获取数据
   综合计算情绪指数，动态调整模拟器波动率
   ============================================ */

const MarketSentiment = (() => {

  // ── 东方财富公开接口 ──
  const API = {
    // 涨跌家数 + 指数行情
    indexInfo: 'https://push2.eastmoney.com/api/qt/ulist.np/get?' +
      'fltt=2&fields=f2,f3,f4,f6,f12,f14,f47,f48,f104,f105,f106' +
      '&secids=1.000001,0.399001&invt=2',

    // 涨停池
    ztPool: 'https://push2ex.eastmoney.com/getTopicZTPool?' +
      'ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt' +
      '&Pageindex=0&pagesize=2000&sort=fbt:asc',

    // 跌停池
    dtPool: 'https://push2ex.eastmoney.com/getTopicDTPool?' +
      'ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt' +
      '&Pageindex=0&pagesize=2000&sort=fbt:asc',

    // 北向资金（分钟级）
    northFlow: 'https://push2.eastmoney.com/api/qt/kamtbs.rtmin/get?' +
      'fields1=f1,f3&fields2=f51,f54,f58',

    // 热门板块涨跌（前20）
    hotSectors: 'https://push2.eastmoney.com/api/qt/clist/get?' +
      'pn=1&pz=20&po=1&np=1&fid=f3&fs=m:90+t:3' +
      '&fields=f12,f14,f2,f3,f4,f62,f204,f205',

    // 腾讯备用 — 单股资金流向
    tencentFlow: 'http://qt.gtimg.cn/q=ff_sh000001',
  };

  // ── 状态 ──
  let sentimentScore = 50;        // 0-100 情绪指数
  let volatilityMultiplier = 1.0; // 波动率乘数
  let lastUpdate = null;
  let updateTimer = null;
  let listeners = [];
  let enabled = false;
  let dataCache = {
    upCount: 0, downCount: 0,     // 涨跌家数
    ztCount: 0, dtCount: 0,      // 涨停/跌停
    totalVolume: 0,               // 全市场成交额(亿)
    northNet: 0,                  // 北向净流入(亿)
    sectorAvg: 0,                 // 板块平均涨跌幅
    sectorHeat: 0,                // 板块热度(头部板块涨幅)
  };

  // 历史数据用于计算变化率
  let prevVolume = 0;
  let prevAdvance = 0;

  // ── 交易时段检测 ──
  function isTradingHours() {
    const now = new Date();
    const day = now.getDay();
    if (day === 0 || day === 6) return false; // 周末
    const h = now.getHours(), m = now.getMinutes();
    const minutes = h * 60 + m;
    // 中国时间 9:25-15:05 (含集合竞价和收盘整理)
    return minutes >= 9 * 60 + 25 && minutes <= 15 * 60 + 5;
  }

  // ── 数据抓取 ──
  async function fetchJSON(url) {
    if (typeof window.marketAPI === 'undefined') return null;
    const raw = await window.marketAPI.fetch(url);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e) { return null; }
  }

  async function fetchAllData() {
    const results = {};

    // 并行抓取（独立接口，互不依赖）
    const [index, zt, dt, north, sectors] = await Promise.all([
      fetchJSON(API.indexInfo).catch(() => null),
      fetchJSON(API.ztPool).catch(() => null),
      fetchJSON(API.dtPool).catch(() => null),
      fetchJSON(API.northFlow).catch(() => null),
      fetchJSON(API.hotSectors).catch(() => null),
    ]);

    results.index = index;
    results.zt = zt;
    results.dt = dt;
    results.north = north;
    results.sectors = sectors;
    return results;
  }

  // ── 情绪计算 ──

  /**
   * 维度1: 涨跌比 (权重30%)
   * 全市场上涨家数 / 下跌家数 → 映射到0-100
   */
  function calcAdvanceDecline(indexData) {
    if (!indexData?.data?.diff) return 50;
    let up = 0, down = 0;
    for (const d of indexData.data.diff) {
      up += (d.f104 || 0);
      down += (d.f105 || 0);
    }
    dataCache.upCount = up;
    dataCache.downCount = down;

    if (up + down === 0) return 50;
    // 涨跌比: 1:1 → 50分, 3:1 → 85分, 1:3 → 15分
    const ratio = up / (up + down);
    return Math.round(ratio * 100);
  }

  /**
   * 维度2: 涨停/跌停对比 (权重25%)
   */
  function calcLimitRatio(ztData, dtData) {
    const ztCount = ztData?.data?.pool?.length || 0;
    const dtCount = dtData?.data?.pool?.length || 0;
    dataCache.ztCount = ztCount;
    dataCache.dtCount = dtCount;

    // 正常市场: 涨停20-80家, 跌停0-20家 = 50-70分
    // 极端牛市: 涨停200+家 = 95分
    // 极端熊市: 跌停200+家 = 5分
    const ztScore = Math.min(100, ztCount * 0.4 + 30);  // 0家→30, 100家→70, 200家→100+
    const dtPenalty = Math.min(50, dtCount * 0.3);       // 0家→0, 100家→30, 200家→50+
    return Math.max(5, Math.min(95, ztScore - dtPenalty));
  }

  /**
   * 维度3: 成交量变化 (权重20%)
   * 基于全市场成交额，与历史值对比
   */
  function calcVolumeChange(indexData) {
    if (!indexData?.data?.diff) return 50;
    let totalAmt = 0;
    for (const d of indexData.data.diff) {
      totalAmt += (d.f48 || 0); // f48 = 成交额(元)
    }
    const volYi = totalAmt / 1e8; // 转为亿元
    dataCache.totalVolume = Math.round(volYi);

    if (prevVolume === 0) { prevVolume = volYi; return 50; }
    // 量增20%→70分, 量缩20%→30分, 量平→50分
    const change = (volYi - prevVolume) / (prevVolume || 1);
    const score = 50 + change * 100;
    prevVolume = volYi;
    return Math.max(10, Math.min(90, Math.round(score)));
  }

  /**
   * 维度4: 北向资金 (权重15%)
   */
  function calcNorthFlow(northData) {
    if (!northData?.data?.data) return 50;
    // 取最近10分钟净流入总和
    const rows = northData.data.data;
    let netFlow = 0;
    const recent = rows.slice(-10);
    for (const r of recent) {
      // r 格式: "时间,沪买入,沪卖出,深买入,深卖出" (可能还有其他字段)
      if (typeof r === 'string') {
        const parts = r.split(',');
        // f54=沪股通(买卖差), f58=深股通(买卖差)
        // 实际字段位置取决于 fields2 配置
        // 简单处理: 取最后4个数值字段
        const nums = parts.slice(1).map(Number).filter(n => !isNaN(n));
        if (nums.length >= 4) {
          netFlow += (nums[0] - nums[1]) + (nums[2] - nums[3]);
        }
      }
    }
    dataCache.northNet = Math.round(netFlow / 1e8 * 100) / 100;

    // 净流入50亿→80分, 净流出50亿→20分, 0→50分
    const score = 50 + (netFlow / 1e8) * 0.6;
    return Math.max(5, Math.min(95, Math.round(score)));
  }

  /**
   * 维度5: 板块轮动热度 (权重10%)
   * 头部板块涨幅离散度 → 市场结构是否健康
   */
  function calcSectorHeat(sectorData) {
    if (!sectorData?.data?.diff) return 50;
    const sectors = sectorData.data.diff;
    if (sectors.length === 0) return 50;

    const changes = sectors.map(s => s.f3 || 0);
    const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
    dataCache.sectorAvg = +avg.toFixed(2);

    // 离散度: 标准差
    const variance = changes.reduce((s, v) => s + (v - avg) ** 2, 0) / changes.length;
    const std = Math.sqrt(variance);
    dataCache.sectorHeat = +std.toFixed(2);

    // 板块平均涨+标准差大 = 结构性行情 (70分)
    // 板块平均涨+标准差小 = 普涨 (80分)
    // 板块平均跌+标准差大 = 恐慌分化 (25分)
    // 板块平均跌+标准差小 = 普跌 (15分)
    const baseScore = 50 + avg * 15;  // +2% → 80, -2% → 20
    const heatBonus = std * 3;         // 高离散度加分
    return Math.max(5, Math.min(90, Math.round(baseScore + heatBonus)));
  }

  /**
   * 综合情绪指数
   */
  function computeSentiment(rawData) {
    const scores = {
      advance:   calcAdvanceDecline(rawData.index),
      limit:     calcLimitRatio(rawData.zt, rawData.dt),
      volume:    calcVolumeChange(rawData.index),
      northFlow: calcNorthFlow(rawData.north),
      sector:    calcSectorHeat(rawData.sectors),
    };

    // 加权综合
    const weights = { advance: 0.30, limit: 0.25, volume: 0.20, northFlow: 0.15, sector: 0.10 };
    let total = 0;
    for (const [key, weight] of Object.entries(weights)) {
      total += (scores[key] || 50) * weight;
    }

    return {
      score: Math.round(Math.max(5, Math.min(95, total))),
      details: scores,
      data: { ...dataCache },
      time: new Date().toISOString()
    };
  }

  /**
   * 情绪指数 → 波动率乘数
   *
   * 逻辑：极端情绪（恐慌或狂热）→ 高波动
   *       中性情绪 → 低波动（正常水平）
   *
   * 映射曲线：U型（中间低，两端高）
   *   score 50 → mult 1.0   (中性)
   *   score 70 → mult 1.3   (偏热)
   *   score 90 → mult 1.6   (狂热)
   *   score 30 → mult 1.3   (偏冷)
   *   score 10 → mult 1.8   (恐慌)
   */
  function scoreToVolatility(sentimentScore) {
    const s = sentimentScore;
    // U型曲线：距离50越远，波动率越大
    const distance = Math.abs(s - 50);
    // 非线性放大：d=0→1.0, d=20→1.25, d=40→1.8
    const mult = 1.0 + (distance / 50) ** 1.6 * 2.0;
    return +Math.max(0.7, Math.min(2.5, mult)).toFixed(3);
  }

  // ── 触发更新 ──
  async function update(force = false) {
    if (!enabled && !force) return;

    // 非交易时段使用上次有效数据（或默认中性）
    if (!isTradingHours() && !force) {
      // 非交易时段：回到中性并通知（确保UI更新）
      sentimentScore = 50;
      volatilityMultiplier = 1.0;
      notify();
      return;
    }

    try {
      const raw = await fetchAllData();
      const result = computeSentiment(raw);
      sentimentScore = result.score;
      volatilityMultiplier = scoreToVolatility(sentimentScore);
      lastUpdate = new Date();
      notify(result);
    } catch(e) {
      console.error('[MarketSentiment] Update failed:', e.message);
    }
  }

  function notify(detail) {
    const data = {
      score: sentimentScore,
      volatilityMultiplier,
      lastUpdate,
      cache: dataCache,
      trading: isTradingHours(),
      ...(detail || {})
    };
    listeners.forEach(fn => { try { fn(data); } catch(e) {} });
  }

  // ── 自动定时 ──
  function start(intervalSec = 60) {
    if (updateTimer) return;
    enabled = true;
    // 立即通知当前中性状态（让 UI 显示），然后异步更新
    notify();
    update();
    updateTimer = setInterval(() => update(), intervalSec * 1000);
  }

  function stop() {
    enabled = false;
    if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
    sentimentScore = 50;
    volatilityMultiplier = 1.0;
    notify();
  }

  function onUpdate(fn) { listeners.push(fn); }

  // ── 简易模式：不依赖网络，基于本地数据生成伪情绪 ──
  // 作为网络不可用时的 fallback
  function getLocalProxy(priceChanges) {
    // 基于当前模拟器中多只股票的涨跌分布估算"市场情绪"
    if (!priceChanges || priceChanges.length === 0) return 50;
    const up = priceChanges.filter(c => c > 0).length;
    const down = priceChanges.filter(c => c < 0).length;
    const total = priceChanges.length || 1;
    return Math.round((up / total) * 100);
  }

  return {
    start, stop, update,
    onUpdate,
    getScore: () => sentimentScore,
    getVolatilityMultiplier: () => volatilityMultiplier,
    getDataCache: () => ({ ...dataCache }),
    isTradingHours,
    getLocalProxy,
    // 基于本地股票数据计算伪情绪（网络不可用时）
    computeFromLocal(stocks) {
      if (!stocks || stocks.length === 0) return 1.0;
      const changes = stocks.map(s => {
        const inst = Simulator.get(s);
        return inst ? inst.getChange().pct : 0;
      });
      const localScore = getLocalProxy(changes);
      return scoreToVolatility(localScore);
    }
  };
})();
