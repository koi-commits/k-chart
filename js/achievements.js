/* ============================================
   achievements.js — Behavioral Psychology Achievement System
   ────────────────────────────────────────────
   Psychological levers:
   1. Variable Ratio Reward  — 随机出现的幸运连胜成就
   2. Progressive Disclosure — 青铜→白银→黄金→钻石层层解锁
   3. Near-Miss Effect       — 进度>80%时推送"差一点"提示
   4. Endowment + Loss Aversion — 每日/每周连登不可断
   5. Social Comparison      — 稀有度百分比 + 对比市场均值
   6. Micro-Milestones       — 每个微小操作都有奖励
   7. Investment Effect      — 交易数/金额里程碑
   8. Curiosity Gap          — ???隐藏成就，条件满足才揭示
   ============================================ */

const AchievementEngine = (() => {

  const STORAGE_KEY = 'kline_achievements_v2';
  const STATS_KEY    = 'kline_achievement_stats_v2';

  // ═══════════════════════════════════════════
  // 成就定义 — 35 achievements × 7 categories
  // ═══════════════════════════════════════════

  const ACHIEVEMENTS = [

    // ────── 交易精通 (8) ──────
    {
      id:'first_trade',   name:'初入股市',     desc:'完成第一笔交易',
      cat:'trading', tier:'bronze',  icon:'🔰', rarity:95,
      check(s){return s.trades >= 1},
      hint:'迈出交易的第一步'
    },
    {
      id:'trade_50',      name:'交易熟手',     desc:'累计完成50笔交易',
      cat:'trading', tier:'silver',  icon:'📈', rarity:55,
      check(s){return s.trades >= 50},
      progress:['trades',50], hint:'积累50笔交易经验'
    },
    {
      id:'trade_100',     name:'百战老兵',     desc:'累计完成100笔交易',
      cat:'trading', tier:'gold',    icon:'⚔️', rarity:28,
      check(s){return s.trades >= 100},
      progress:['trades',100], hint:'百笔交易的经验积累'
    },
    {
      id:'trade_500',     name:'交易大师',     desc:'累计完成500笔交易',
      cat:'trading', tier:'diamond', icon:'👑', rarity:5,
      check(s){return s.trades >= 500},
      progress:['trades',500], hint:'五百笔交易的淬炼'
    },
    {
      id:'winrate_70',    name:'七成胜算',     desc:'近20笔交易胜率 >= 70%',
      cat:'trading', tier:'gold',    icon:'🏆', rarity:18,
      check(s){return s.recentWinRate20 >= 70},
      progress:['recentWinRate20',70], hint:'20笔交易中胜率突破70%'
    },
    {
      id:'winrate_85',    name:'神级胜率',     desc:'近20笔交易胜率 >= 85%',
      cat:'trading', tier:'diamond', icon:'🌟', rarity:3,
      check(s){return s.recentWinRate20 >= 85},
      progress:['recentWinRate20',85], hint:'几乎弹无虚发的交易精准度'
    },
    {
      id:'perfect_day',   name:'完美交易日',   desc:'单日所有交易全部盈利（至少3笔）',
      cat:'trading', tier:'gold',    icon:'✨', rarity:12,
      check(s){return s.perfectDay},
      hint:'一天之内，笔笔盈利', reveal(){return stats.trades >= 30}
    },
    {
      id:'loss_aversion', name:'止损的艺术',   desc:'触发止损后账户仍保持盈利',
      cat:'trading', tier:'silver',  icon:'🛡️', rarity:22,
      check(s){return s.stoppedLossButGreen},
      hint:'止损不可怕，总账仍是正的'
    },

    // ────── 财富积累 (5) ──────
    {
      id:'profit_1k',     name:'小有斩获',     desc:'累计盈利达到 ¥1,000',
      cat:'wealth', tier:'bronze',  icon:'💰', rarity:78,
      check(s){return s.totalProfit >= 1000},
      progress:['totalProfit',1000], hint:'累计盈利突破千元大关'
    },
    {
      id:'profit_10k',    name:'万元户',       desc:'累计盈利达到 ¥10,000',
      cat:'wealth', tier:'silver',  icon:'💵', rarity:42,
      check(s){return s.totalProfit >= 10000},
      progress:['totalProfit',10000], hint:'累计盈利突破万元'
    },
    {
      id:'profit_100k',   name:'财务自由之路', desc:'累计盈利达到 ¥100,000',
      cat:'wealth', tier:'gold',    icon:'🏦', rarity:14,
      check(s){return s.totalProfit >= 100000},
      progress:['totalProfit',100000], hint:'累计盈利突破十万'
    },
    {
      id:'profit_1m',     name:'百万富翁',     desc:'累计盈利达到 ¥1,000,000',
      cat:'wealth', tier:'diamond', icon:'💎', rarity:2,
      check(s){return s.totalProfit >= 1000000},
      progress:['totalProfit',1000000], hint:'累计盈利突破百万'
    },
    {
      id:'profit_10m',    name:'股神降临',     desc:'累计盈利达到 ¥10,000,000',
      cat:'wealth', tier:'diamond', icon:'🏰', rarity:0.2,
      check(s){return s.totalProfit >= 10000000},
      progress:['totalProfit',10000000], hint:'在这个市场封神'
    },

    // ────── 策略分析 (6) ──────
    {
      id:'first_backtest', name:'纸上谈兵',    desc:'完成第一次策略回测',
      cat:'strategy', tier:'bronze',  icon:'🧪', rarity:72,
      check(s){return s.backtests >= 1},
      hint:'运行你的第一次回测'
    },
    {
      id:'all_strategies', name:'策略大师',    desc:'运行过全部5种预设策略回测',
      cat:'strategy', tier:'gold',    icon:'🧠', rarity:20,
      check(s){return s.uniqueStrategies >= 5},
      progress:['uniqueStrategies',5], hint:'尝试每一种预设策略'
    },
    {
      id:'sharpe_20',      name:'夏普之星',    desc:'回测夏普比率 >= 2.0',
      cat:'strategy', tier:'gold',    icon:'⭐', rarity:10,
      check(s){return s.maxSharpe >= 2.0},
      progress:['maxSharpe',2], hint:'找到夏普比率超2.0的策略'
    },
    {
      id:'backtest_wr70',  name:'回测高手',    desc:'回测胜率达到70%以上',
      cat:'strategy', tier:'silver',  icon:'🎯', rarity:28,
      check(s){return s.maxBacktestWinRate >= 70},
      progress:['maxBacktestWinRate',70], hint:'回测验证，胜率超七成'
    },
    {
      id:'use_all_inds',   name:'指标专家',    desc:'使用过RSI、KDJ、MACD三种指标',
      cat:'strategy', tier:'bronze',  icon:'🔍', rarity:58,
      check(s){return s.indicatorsToggled >= 3},
      progress:['indicatorsToggled',3], hint:'打开每一种技术指标面板'
    },
    {
      id:'profit_factor',  name:'盈亏有道',    desc:'盈亏比（Profit Factor）>= 2.0',
      cat:'strategy', tier:'gold',    icon:'⚖️', rarity:20,
      check(s){return s.profitFactor >= 2.0 && s.trades >= 20},
      progress:['profitFactor',2], hint:'让盈利远大于亏损'
    },

    // ────── 形态识别 (5) ──────
    {
      id:'first_pattern',  name:'火眼金睛',    desc:'首次识别K线形态',
      cat:'pattern', tier:'bronze',  icon:'👁️', rarity:88,
      check(s){return s.patternsSpotted >= 1},
      hint:'观察K线，发现形态信号'
    },
    {
      id:'pattern_5',      name:'形态猎手',    desc:'识别5种不同K线形态',
      cat:'pattern', tier:'silver',  icon:'🎯', rarity:50,
      check(s){return s.uniquePatterns >= 5},
      progress:['uniquePatterns',5], hint:'识别出5种经典K线形态'
    },
    {
      id:'pattern_10',     name:'技术分析专家', desc:'识别10种不同K线形态',
      cat:'pattern', tier:'gold',    icon:'🔬', rarity:22,
      check(s){return s.uniquePatterns >= 10},
      progress:['uniquePatterns',10], hint:'识别出10种经典K线形态'
    },
    {
      id:'pattern_all',    name:'蜡烛图大师',   desc:'识别全部20种K线形态',
      cat:'pattern', tier:'diamond', icon:'🏯', rarity:3,
      check(s){return s.uniquePatterns >= 20},
      progress:['uniquePatterns',20], hint:'集齐全部20种蜡烛图形态'
    },
    {
      id:'rare_pattern',   name:'稀有发现',    desc:'识别到启明星、黄昏星或三只乌鸦',
      cat:'pattern', tier:'silver',  icon:'⭐', rarity:28,
      check(s){return s.spottedRarePattern},
      hint:'三种最强的反转形态之一'
    },

    // ────── 风险管理 (4) ──────
    {
      id:'first_sl',       name:'安全第一',    desc:'第一次设置止损',
      cat:'risk', tier:'bronze',  icon:'⛔', rarity:68,
      check(s){return s.stopLosses >= 1},
      hint:'为你的第一笔交易设置止损'
    },
    {
      id:'first_tp',       name:'落袋为安',    desc:'第一次设置止盈',
      cat:'risk', tier:'bronze',  icon:'✅', rarity:62,
      check(s){return s.takeProfits >= 1},
      hint:'为你的第一笔交易设置止盈'
    },
    {
      id:'oco_master',     name:'双保险',      desc:'使用OCO括号单（同时设止盈止损）',
      cat:'risk', tier:'silver',  icon:'🔗', rarity:28,
      check(s){return s.ocoUsed},
      hint:'同时设置止盈止损的OCO订单'
    },
    {
      id:'safe_20',        name:'不破金身',    desc:'连续20笔交易未被止损',
      cat:'risk', tier:'gold',    icon:'🔱', rarity:8,
      check(s){return s.safeStreak >= 20},
      progress:['safeStreak',20], hint:'止损线一次都不被触发'
    },

    // ────── 持久坚持 (5) ──────
    {
      id:'day_3',          name:'三天打鱼',    desc:'连续3天登录',
      cat:'persist', tier:'bronze',  icon:'📅', rarity:68,
      check(s){return s.loginStreak >= 3},
      progress:['loginStreak',3], hint:'连续登录3天不中断'
    },
    {
      id:'day_7',          name:'七日之约',    desc:'连续7天登录',
      cat:'persist', tier:'silver',  icon:'🔥', rarity:38,
      check(s){return s.loginStreak >= 7},
      progress:['loginStreak',7], hint:'连续登录7天'
    },
    {
      id:'day_30',         name:'钢铁意志',    desc:'连续30天登录',
      cat:'persist', tier:'gold',    icon:'🗓️', rarity:6,
      check(s){return s.loginStreak >= 30},
      progress:['loginStreak',30], hint:'风雨无阻，连续30天'
    },
    {
      id:'candle_10k',     name:'万烛守望',    desc:'累计生成10,000根K线',
      cat:'persist', tier:'silver',  icon:'🏮', rarity:28,
      check(s){return s.candlesGenerated >= 10000},
      progress:['candlesGenerated',10000], hint:'耐心等待一万根K线'
    },
    {
      id:'all_6_tools',    name:'画线艺术家',  desc:'使用全部6种画线工具',
      cat:'persist', tier:'silver',  icon:'✏️', rarity:38,
      check(s){return s.uniqueDrawingTools >= 6},
      progress:['uniqueDrawingTools',6], hint:'趋势线、斐波那契、矩形...每一种都试试'
    },

    // ────── 秘密/隐藏成就 (7) — 可变比率奖励 ──────
    {
      id:'lucky_streak_5', name:'鸿运当头',    desc:'连续5笔交易盈利',
      cat:'secret', tier:'secret',  icon:'🍀', rarity:15,
      check(s){return s.currentWinStreak >= 5},
      reveal(){return stats.currentWinStreak >= 3}
    },
    {
      id:'lucky_streak_10', name:'天选之人',   desc:'连续10笔交易盈利',
      cat:'secret', tier:'diamond', icon:'🌈', rarity:2,
      check(s){return s.currentWinStreak >= 10},
      reveal(){return stats.currentWinStreak >= 7}
    },
    {
      id:'reversal_king',  name:'绝地反击',    desc:'连续亏损5笔后大逆转盈利超5%',
      cat:'secret', tier:'secret',  icon:'🔄', rarity:8,
      check(s){return s.bigReversal},
      reveal(){return stats.consecutiveLosses >= 3}
    },
    {
      id:'night_owl',      name:'深夜交易者',  desc:'在深夜时段（23:00-05:00）完成一笔交易',
      cat:'secret', tier:'secret',  icon:'🦉', rarity:15,
      check(s){return s.nightOwl},
      reveal(){return stats.trades >= 10}
    },
    {
      id:'big_winner',     name:'一鸣惊人',    desc:'单笔交易盈利超过 ¥50,000',
      cat:'secret', tier:'gold',    icon:'🎆', rarity:5,
      check(s){return s.maxSingleProfit >= 50000},
      reveal(){return stats.maxSingleProfit >= 10000}
    },
    {
      id:'collector',      name:'行业研究员',  desc:'交易过全部15个板块的股票',
      cat:'secret', tier:'gold',    icon:'🏭', rarity:5,
      check(s){return s.uniqueSectorsTraded >= 15},
      progress:['uniqueSectorsTraded',15],
      reveal(){return stats.uniqueSectorsTraded >= 5}
    },
    {
      id:'speed_demon',    name:'闪电交易者',  desc:'同一根K线内完成买卖（超短线）',
      cat:'secret', tier:'secret',  icon:'⚡', rarity:12,
      check(s){return s.speedDemon},
      reveal(){return stats.trades >= 20}
    },
  ];

  // ═══════════════════════════════════════════
  // 统计状态
  // ═══════════════════════════════════════════

  let unlocked = {};
  let stats = {};
  let listeners = [];
  let nearMissQueue = [];

  function initStats() {
    const defaults = {
      trades: 0, totalProfit: 0, maxSingleProfit: 0,
      recentWinRate20: 0, perfectDay: false, stoppedLossButGreen: false,
      currentWinStreak: 0, maxWinStreak: 0, consecutiveLosses: 0,
      backtests: 0, uniqueStrategies: 0, maxSharpe: 0,
      maxBacktestWinRate: 0, indicatorsToggled: 0, profitFactor: 0,
      patternsSpotted: 0, uniquePatterns: [], spottedRarePattern: false,
      stopLosses: 0, takeProfits: 0, ocoUsed: false, safeStreak: 0,
      loginStreak: 0, lastLoginDate: '', candlesGenerated: 0,
      uniqueDrawingTools: [], uniqueTimeframes: [],
      maxDrawdownPct: 100, nightOwl: false, bigReversal: false,
      speedDemon: false, uniqueSectorsTraded: 0, uniqueStocksTraded: 0,
      recentPatterns: [], dayTradeLog: {},  // for perfect day check
      _lastSummary: null,
    };
    for (const k in defaults) {
      if (!(k in stats)) stats[k] = defaults[k];
    }
  }

  function load() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (raw) unlocked = JSON.parse(raw);
      raw = localStorage.getItem(STATS_KEY);
      if (raw) stats = JSON.parse(raw);
    } catch(e) { /* ignore */ }
    initStats();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(unlocked));
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch(e) { /* ignore */ }
  }

  // ═══════════════════════════════════════════
  // 统计数据更新
  // ═══════════════════════════════════════════

  function recordTrade(tradeResult) {
    if (!tradeResult || !tradeResult.success) return;
    const trade = tradeResult.trade;
    stats.trades++;

    // ---- 从 Trader 获取整体状态 ----
    let summary = null;
    try {
      if (typeof Trader !== 'undefined') summary = Trader.getSummary();
    } catch(e) {}

    if (summary) {
      stats.totalProfit = summary.totalPnL;
      stats.maxDrawdownPct = Math.min(stats.maxDrawdownPct,
        (summary.totalPnLPct < 0 ? Math.abs(summary.totalPnLPct) : 0));
      stats.profitFactor = summary.totalPnL > 0 && stats.trades >= 20
        ? (summary.totalPnL / summary.initialCapital * (summary.positionCount || 1)).toFixed
        : stats.profitFactor;
    }

    // ---- 每笔交易分析 ----
    if (trade && trade.side === 'sell') {
      let pnl = 0;
      let pnlPct = 0;

      // 粗略估算：对比最近同标的买入
      if (stats._lastSummary && summary) {
        pnl = summary.totalPnL - (stats._lastSummary.totalPnL || summary.totalPnL);
        pnlPct = summary.initialCapital > 0 ? (pnl / summary.initialCapital) * 100 : 0;
      }
      stats._lastSummary = summary;

      if (pnl > 0) {
        stats.currentWinStreak++;
        stats.maxWinStreak = Math.max(stats.maxWinStreak, stats.currentWinStreak);
        stats.maxSingleProfit = Math.max(stats.maxSingleProfit, pnl);
        stats.consecutiveLosses = 0;
        stats.safeStreak++;
        stats.firstProfit = true;
      } else if (pnl < 0) {
        stats.currentWinStreak = 0;
        stats.consecutiveLosses++;
        stats.safeStreak = 0;
      }

      // 止损但仍然整体盈利
      if (tradeResult.tpSlType === 'sl' && summary && summary.totalPnL > 0) {
        stats.stoppedLossButGreen = true;
      }

      // 近20笔胜率
      if (stats.trades >= 5) {
        // 用 Analytics 精确值，降级到简单估计
        try {
          if (typeof Analytics !== 'undefined') {
            const aStats = Analytics.getStats();
            if (aStats && aStats.totalTrades >= 5) {
              stats.recentWinRate20 = aStats.winRate;
            }
          }
        } catch(e) {}
      }

      // 完美日检查
      const today = new Date().toDateString();
      if (!stats.dayTradeLog[today]) stats.dayTradeLog[today] = [];
      stats.dayTradeLog[today].push(pnl > 0 ? 'win' : 'loss');
      const todayResults = stats.dayTradeLog[today];
      if (todayResults.length >= 3 && todayResults.every(function(r){return r==='win'})) {
        stats.perfectDay = true;
      }

      // 绝地反击检查
      if (pnlPct > 5 && stats.consecutiveLosses >= 5) {
        stats.bigReversal = true;
      }

      // 深夜交易者检查
      const hour = new Date().getHours();
      if (hour >= 23 || hour < 5) stats.nightOwl = true;
    }

    // 超短线检查（同一分钟内买卖）
    if (trade && trade.side === 'sell') {
      const recent = (stats._recentBuyTimes || {});
      const sym = trade.symbol;
      if (recent[sym] && (Date.now() - recent[sym]) < 60000) {
        stats.speedDemon = true;
      }
    }
    if (trade && trade.side === 'buy') {
      if (!stats._recentBuyTimes) stats._recentBuyTimes = {};
      stats._recentBuyTimes[trade.symbol] = Date.now();
    }

    // 板块记录
    if (trade) recordStockTraded(trade.symbol);

    save();
    checkAndNotify();
  }

  function recordBacktest(result) {
    stats.backtests++;
    if (result && result.stats) {
      stats.maxSharpe = Math.max(stats.maxSharpe, result.stats.sharpeRatio || 0);
      stats.maxBacktestWinRate = Math.max(stats.maxBacktestWinRate, result.stats.winRate || 0);
      if (result.stats.profitFactor) {
        stats.profitFactor = Math.max(stats.profitFactor, result.stats.profitFactor);
      }
    }
    // 跟踪策略
    if (result && result._presetKey) {
      const used = JSON.parse(localStorage.getItem('kline_bt_strategies') || '[]');
      if (used.indexOf(result._presetKey) < 0) {
        used.push(result._presetKey);
        stats.uniqueStrategies = used.length;
        localStorage.setItem('kline_bt_strategies', JSON.stringify(used));
      }
    }
    save();
    checkAndNotify();
  }

  function recordSLTP(type) {
    if (type === 'sl') stats.stopLosses++;
    if (type === 'tp') stats.takeProfits++;
    save();
    checkAndNotify();
  }

  function recordOCO() {
    stats.ocoUsed = true;
    save();
    checkAndNotify();
  }

  function recordCandle() {
    stats.candlesGenerated++;
    // 每100根检查一次，避免过于频繁
    if (stats.candlesGenerated % 100 === 0) {
      save();
      checkAndNotify();
    }
  }

  function recordDrawingTool(tool) {
    if (!tool) return;
    if (stats.uniqueDrawingTools.indexOf(tool) < 0) {
      stats.uniqueDrawingTools.push(tool);
      save();
      checkAndNotify();
    }
  }

  function recordTimeframe(tf) {
    if (!tf) return;
    if (stats.uniqueTimeframes.indexOf(tf) < 0) {
      stats.uniqueTimeframes.push(tf);
      save();
      checkAndNotify();
    }
  }

  function recordIndicator(ind) {
    if (!ind) return;
    const used = JSON.parse(localStorage.getItem('kline_inds_used') || '[]');
    if (used.indexOf(ind) < 0) {
      used.push(ind);
      stats.indicatorsToggled = used.length;
      localStorage.setItem('kline_inds_used', JSON.stringify(used));
      save();
      checkAndNotify();
    }
  }

  function recordPattern(patternName) {
    if (!patternName) return;
    stats.patternsSpotted++;
    if (stats.uniquePatterns.indexOf(patternName) < 0) {
      stats.uniquePatterns.push(patternName);
      if (patternName === '启明星' || patternName === '黄昏星' || patternName === '三只乌鸦') {
        stats.spottedRarePattern = true;
      }
    }
    // 近5个形态追踪（用于组合成就）
    stats.recentPatterns.push(patternName);
    if (stats.recentPatterns.length > 5) stats.recentPatterns.shift();
    if (stats.recentPatterns.indexOf('锤子线') >= 0 &&
        stats.recentPatterns.indexOf('看涨吞没') >= 0) {
      stats.patternCombo = true;
    }
    save();
    checkAndNotify();
  }

  function recordStockTraded(sym) {
    if (!sym) return;
    const traded = JSON.parse(localStorage.getItem('kline_stocks_traded') || '[]');
    if (traded.indexOf(sym) < 0) {
      traded.push(sym);
      stats.uniqueStocksTraded = traded.length;
      localStorage.setItem('kline_stocks_traded', JSON.stringify(traded));
    }
    // 板块追踪
    try {
      if (typeof Simulator !== 'undefined' && Simulator.STOCKS) {
        const cfg = Simulator.STOCKS[sym];
        if (cfg && cfg.sector) {
          const sectors = JSON.parse(localStorage.getItem('kline_sectors_traded') || '[]');
          if (sectors.indexOf(cfg.sector) < 0) {
            sectors.push(cfg.sector);
            stats.uniqueSectorsTraded = sectors.length;
            localStorage.setItem('kline_sectors_traded', JSON.stringify(sectors));
          }
        }
      }
    } catch(e) {}
    save();
  }

  // ═══════════════════════════════════════════
  // 每日登录 + 连登追踪
  // ═══════════════════════════════════════════

  function checkDailyLogin() {
    const today = new Date().toDateString();
    if (stats.lastLoginDate !== today) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      if (stats.lastLoginDate === yesterday) {
        stats.loginStreak++;
      } else {
        stats.loginStreak = 1;
      }
      stats.lastLoginDate = today;
      save();
      checkAndNotify();
    }
  }

  // ═══════════════════════════════════════════
  // 成就检测 + 近失提示
  // ═══════════════════════════════════════════

  function checkAll() {
    const newlyUnlocked = [];
    ACHIEVEMENTS.forEach(function(ach) {
      if (unlocked[ach.id]) return;
      if (ach.check(stats)) {
        unlocked[ach.id] = Date.now();
        newlyUnlocked.push(ach);
      }
    });
    if (newlyUnlocked.length > 0) {
      save();
      newlyUnlocked.forEach(function(ach) {
        notifyListeners({ type:'unlock', achievement:ach });
      });
    }
    return newlyUnlocked;
  }

  /**
   * 检查近失成就 (Near-Miss Effect)
   * 进度 > 80% 的成就 → 触发 "差一点" 提示
   */
  function getNearlyComplete() {
    return ACHIEVEMENTS.filter(function(ach) {
      if (unlocked[ach.id]) return false;
      if (!ach.progress) return false;
      // hidden 成就未揭示时跳过
      if (ach.reveal && !ach.reveal()) return false;
      const p = getProgress(ach);
      return p && p.pct >= 80 && p.pct < 100;
    }).map(function(ach) {
      const p = getProgress(ach);
      return {
        id: ach.id,
        name: ach.name,
        icon: ach.icon,
        current: p.current,
        target: p.target,
        pct: p.pct,
      };
    });
  }

  function checkAndNotify() {
    const unlocked = checkAll();
    // 近失检查：仅在交易相关事件时触发（避免刚打开就有大量提示）
    const nearly = getNearlyComplete();
    if (nearly.length > 0 && unlocked.length === 0) {
      // 最多推送1个（最有希望完成的）
      nearly.sort(function(a, b) { return b.pct - a.pct; });
      nearMissQueue.push(nearly[0]);
    }
    return unlocked;
  }

  function popNearMiss() {
    if (nearMissQueue.length === 0) return null;
    return nearMissQueue.shift();
  }

  function getNearMissQueue() {
    return nearMissQueue.slice();
  }

  // ═══════════════════════════════════════════
  // 进度查询
  // ═══════════════════════════════════════════

  function getProgress(ach) {
    if (!ach.progress) return null;
    const key = ach.progress[0];
    const target = ach.progress[1];
    const current = stats[key] !== undefined
      ? (typeof stats[key] === 'number' ? stats[key]
        : (Array.isArray(stats[key]) ? stats[key].length : 0))
      : 0;
    return {
      current: current,
      target: target,
      pct: Math.min(100, Math.round((current / target) * 100)),
    };
  }

  // ═══════════════════════════════════════════
  // 查询接口
  // ═══════════════════════════════════════════

  function getAll() {
    return ACHIEVEMENTS.map(function(ach) {
      const u = !!unlocked[ach.id];
      const revealed = !ach.reveal || ach.reveal() || u;
      const prog = ach.progress ? getProgress(ach) : null;

      return {
        id: ach.id,
        name: revealed ? ach.name : '???',
        desc: revealed ? ach.desc : (ach.hint || '???'),
        cat: ach.cat,
        tier: ach.tier,
        icon: revealed ? ach.icon : '❓',
        unlocked: u,
        unlockedAt: unlocked[ach.id] || 0,
        rarity: ach.rarity,
        progress: prog,
        progressable: !!ach.progress,
        revealed: revealed,
        hint: ach.hint || '',
      };
    });
  }

  function getByCategory() {
    const all = getAll();
    const map = {};
    const catNames = {
      trading:'交易精通', strategy:'策略分析', pattern:'形态识别',
      risk:'风险管理', persist:'持久坚持', wealth:'财富积累', secret:'隐藏成就'
    };
    all.forEach(function(a) {
      const label = catNames[a.cat] || a.cat;
      if (!map[label]) map[label] = [];
      map[label].push(a);
    });
    return map;
  }

  function getOverallProgress() {
    const visible = ACHIEVEMENTS.filter(function(a) {
      return !a.reveal || a.reveal() || unlocked[a.id];
    });
    const totalVisible = visible.length;
    const unlockedCount = visible.filter(function(a) { return unlocked[a.id]; }).length;
    let totalPoints = 0;
    visible.forEach(function(a) {
      if (unlocked[a.id]) {
        const tierPoints = { bronze:10, silver:25, gold:60, diamond:150, secret:80 };
        totalPoints += tierPoints[a.tier] || 10;
      }
    });
    return {
      visible: totalVisible,
      unlocked: unlockedCount,
      totalDefined: ACHIEVEMENTS.length,
      totalUnlockedAll: Object.keys(unlocked).length,
      pct: totalVisible > 0 ? Math.round((unlockedCount / totalVisible) * 100) : 0,
      points: totalPoints,
    };
  }

  function isUnlocked(id) { return !!unlocked[id]; }

  function getUnlocked() {
    return ACHIEVEMENTS.filter(function(a) { return unlocked[a.id]; });
  }

  function getLocked() {
    return ACHIEVEMENTS.filter(function(a) { return !unlocked[a.id]; });
  }

  function getUnlockCount() { return Object.keys(unlocked).length; }

  function getTotalCount() { return ACHIEVEMENTS.length; }

  function getUnlockTime(id) { return unlocked[id] || null; }

  function getStats() { return stats; }

  function onUnlock(fn) { listeners.push(fn); }

  function notifyListeners(data) {
    listeners.forEach(function(fn) {
      try { fn(data); } catch(e) {}
    });
  }

  function resetAll() {
    unlocked = {};
    stats = {};
    nearMissQueue = [];
    initStats();
    save();
  }

  // ═══════════════════════════════════════════
  // 初始化
  // ═══════════════════════════════════════════

  function init() {
    load();
    checkDailyLogin();
  }

  load();
  initStats();

  return {
    init, checkAll, checkAndNotify,
    getStats, isUnlocked, getAll, getUnlocked, getLocked,
    getByCategory, getOverallProgress,
    getProgress, getNearlyComplete, popNearMiss, getNearMissQueue,
    getUnlockCount, getTotalCount, getUnlockTime, onUnlock,
    recordTrade, recordBacktest, recordSLTP, recordOCO,
    recordCandle, recordDrawingTool, recordTimeframe, recordIndicator,
    recordPattern, recordStockTraded,
    checkDailyLogin, resetAll, save,
    ACHIEVEMENTS,  // 只读引用
  };
})();
