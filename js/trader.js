/* ============================================
   trader.js — 模拟交易引擎
   资金管理 · 买卖下单 · 市场冲击 · 持仓盈亏
   ============================================ */

const Trader = (() => {

  // ────── A股费率 ──────
  const FEE = {
    commissionRate: 0.00025,  // 佣金万2.5
    minCommission: 5,         // 最低佣金 ¥5
    stampDutyRate: 0.001,     // 印花税千1（仅卖出）
    transferFeeRate: 0.00002, // 过户费万0.2
  };

  // ────── 账户状态 ──────
  const account = {
    initialCapital: 100000,
    cash: 100000,
    positions: {},     // { symbol: { shares, avgCost, totalCost } }
    trades: [],        // [{ time, symbol, side, price, shares, fee, total }]
    orders: [],        // 当日委托记录
  };

  // SL/TP 挂单（现有持仓的止盈止损）
  let pendingOrders = [];  // [{ symbol, slPrice?, tpPrice?, shares, avgCost }]

  // 委托订单簿：限价单、止损单、括号单(OCO)
  // [{ id, type:'limit'|'stop'|'bracket', symbol, side:'buy'|'sell', shares,
  //    limitPrice?, stopPrice?, tpPrice?, slPrice?, entryPrice?, createdAt }]
  let orderBook = [];
  let orderIdCounter = 1000;

  // 监听器
  let listeners = [];

  function notify(event, data) {
    listeners.forEach(fn => fn(event, data));
  }

  // ────── 计算持仓市值和盈亏 ──────
  function getPositionInfo(symbol) {
    const pos = account.positions[symbol];
    if (!pos || pos.shares === 0) return null;

    const sim = Simulator.get(symbol);
    const currentPrice = sim.getPrice();
    const marketValue = pos.shares * currentPrice;
    const costValue = pos.shares * pos.avgCost;
    const pnl = marketValue - costValue;
    const pnlPct = costValue > 0 ? (pnl / costValue) * 100 : 0;

    return {
      symbol,
      name: Simulator.STOCKS[symbol].name,
      shares: pos.shares,
      avgCost: pos.avgCost,
      currentPrice,
      marketValue,
      pnl,
      pnlPct,
    };
  }

  function getAllPositions() {
    return Object.keys(account.positions)
      .map(getPositionInfo)
      .filter(p => p && p.shares > 0);
  }

  function getTotalMarketValue() {
    return getAllPositions().reduce((sum, p) => sum + p.marketValue, 0);
  }

  function getTotalPnL() {
    return getAllPositions().reduce((sum, p) => sum + p.pnl, 0);
  }

  function getTotalAssets() {
    return account.cash + getTotalMarketValue();
  }

  // ────── 市场冲击模型 ──────
  /**
   * 计算大单对价格的冲击（平方根法则 + 盘口深度）
   *
   * @param {string} symbol - 股票代码
   * @param {string} side - 'buy' | 'sell'
   * @param {number} shares - 交易股数
   * @returns {object} { avgPrice, impactPct, levelsConsumed }
   */
  function calculateMarketImpact(symbol, side, shares) {
    const sim = Simulator.get(symbol);
    const price = sim.getPrice();
    const cfg = Simulator.STOCKS[symbol];

    // 1. 平方根冲击模型
    const baseVol = 500000; // 基准成交量（股）
    const volatility = cfg.annualVol || cfg.volatility || 0.25;
    const participation = shares / baseVol;
    const sqrtImpact = 0.5 * volatility * Math.sqrt(Math.abs(participation));
    const direction = side === 'buy' ? 1 : -1;

    // 2. 盘口深度消耗
    // 模拟五档每档深度（手），逐档消耗
    const levelDepth = [
      Math.floor(100 + Math.random() * 300),  // 档1: 100-400手
      Math.floor(200 + Math.random() * 500),  // 档2
      Math.floor(300 + Math.random() * 800),  // 档3
      Math.floor(500 + Math.random() * 1500), // 档4
      Math.floor(1000 + Math.random() * 3000),// 档5
    ];

    const priceStep = price * 0.001; // 每档价格步进 0.1%
    let remaining = Math.ceil(shares / 100); // 转为手数（1手=100股）
    let totalCost = 0;
    let filled = 0;
    let levelsConsumed = 0;

    for (let i = 0; i < levelDepth.length && remaining > 0; i++) {
      const depth = levelDepth[i];
      const fillHere = Math.min(remaining, depth);
      const levelPrice = price * (1 + direction * i * 0.001); // 每档价格递增

      totalCost += fillHere * 100 * levelPrice;
      filled += fillHere * 100;
      remaining -= fillHere;
      levelsConsumed++;
    }

    // 如果订单超过五档总深度，剩余部分按更高的冲击价格
    if (remaining > 0) {
      const slippagePrice = price * (1 + direction * (sqrtImpact + 0.01));
      totalCost += remaining * 100 * slippagePrice;
      filled += remaining * 100;
    }

    const avgPrice = filled > 0 ? totalCost / filled : price;
    const impactPct = ((avgPrice - price) / price) * 100 * direction;

    return {
      avgPrice: +avgPrice.toFixed(2),
      impactPct: +impactPct.toFixed(3),
      levelsConsumed,
      totalShares: filled,
    };
  }

  // ────── 费用计算 ──────
  function calcFee(side, price, shares) {
    const tradeValue = price * shares;
    let commission = Math.max(tradeValue * FEE.commissionRate, FEE.minCommission);
    let stampDuty = side === 'sell' ? tradeValue * FEE.stampDutyRate : 0;
    let transferFee = tradeValue * FEE.transferFeeRate;

    return {
      commission: +commission.toFixed(2),
      stampDuty: +stampDuty.toFixed(2),
      transferFee: +transferFee.toFixed(2),
      total: +(commission + stampDuty + transferFee).toFixed(2),
    };
  }

  // ────── 下单 ──────
  /**
   * 执行买卖
   * @param {string} symbol
   * @param {string} side - 'buy' | 'sell'
   * @param {number} shares
   * @param {object} opts - { slPrice?, tpPrice? }
   */
  function placeOrder(symbol, side, shares, opts = {}) {
    // 1. 股数验证
    shares = Math.floor(shares / 100) * 100;
    if (shares < 100) {
      return { success: false, message: '最小交易单位为100股（1手）' };
    }

    const impact = calculateMarketImpact(symbol, side, shares);
    const fee = calcFee(side, impact.avgPrice, shares);
    const totalValue = impact.avgPrice * shares;

    // 2. 买入：资金检查
    if (side === 'buy') {
      const needed = totalValue + fee.total;
      if (needed > account.cash) {
        const maxShares = Math.floor((account.cash - fee.total) / impact.avgPrice / 100) * 100;
        return {
          success: false,
          message: `资金不足！需要 ¥${needed.toFixed(2)}，可用 ¥${account.cash.toFixed(2)}。最多可买 ${maxShares} 股`,
        };
      }
      // 扣款
      account.cash -= totalValue + fee.total;

      // 更新持仓
      if (!account.positions[symbol]) {
        account.positions[symbol] = { shares: 0, avgCost: 0, totalCost: 0 };
      }
      const pos = account.positions[symbol];
      const newTotalCost = pos.totalCost + totalValue;
      pos.shares += shares;
      pos.totalCost = newTotalCost;
      pos.avgCost = newTotalCost / pos.shares;
    }

    // 3. 卖出：持仓检查
    if (side === 'sell') {
      const pos = account.positions[symbol];
      if (!pos || pos.shares < shares) {
        const held = pos ? pos.shares : 0;
        return { success: false, message: `持仓不足！持有 ${held} 股，卖出 ${shares} 股` };
      }
      // 入账
      account.cash += totalValue - fee.total;

      // 更新持仓
      pos.shares -= shares;
      pos.totalCost -= pos.avgCost * shares;
      if (pos.shares === 0) {
        pos.avgCost = 0;
        pos.totalCost = 0;
      }
    }

    // 4. 记录交易
    const trade = {
      id: account.trades.length + 1,
      time: Date.now(),
      symbol,
      side,
      price: impact.avgPrice,
      shares,
      fee: fee.total,
      total: totalValue,
      impactPct: impact.impactPct,
      levelsConsumed: impact.levelsConsumed,
      cashAfter: account.cash,
    };
    account.trades.push(trade);
    account.orders.unshift(trade);

    // 5. SL/TP 挂单
    if (side === 'buy' && (opts.slPrice || opts.tpPrice)) {
      pendingOrders.push({
        symbol,
        slPrice: opts.slPrice || null,
        tpPrice: opts.tpPrice || null,
        shares,
        avgCost: impact.avgPrice,
      });
    }
    // 卖出时清除对应的SL/TP
    if (side === 'sell' && pendingOrders.length > 0) {
      const pos = account.positions[symbol];
      if (!pos || pos.shares === 0) {
        pendingOrders = pendingOrders.filter(o => o.symbol !== symbol);
      }
    }

    // 6. 通知更新
    notify('trade', trade);
    notify('account', getSummary());

    return {
      success: true,
      message: `${side === 'buy' ? '买入' : '卖出'}成交！${shares}股 @ ¥${impact.avgPrice.toFixed(2)}，
冲击 ${impact.impactPct.toFixed(2)}%，佣金 ¥${fee.total.toFixed(2)}`,
      trade,
      impact,
      fee,
    };
  }

  // ────── 查询接口 ──────
  function getSummary() {
    const mv = getTotalMarketValue();
    const pnl = getTotalPnL();
    return {
      initialCapital: account.initialCapital,
      cash: +account.cash.toFixed(2),
      marketValue: +mv.toFixed(2),
      totalAssets: +(account.cash + mv).toFixed(2),
      totalPnL: +pnl.toFixed(2),
      totalPnLPct: +((pnl / account.initialCapital) * 100).toFixed(2),
      positionCount: getAllPositions().length,
      tradeCount: account.trades.length,
    };
  }

  function getTrades(limit = 20) {
    return account.trades.slice(-limit).reverse();
  }

  function getOrders(limit = 20) {
    return account.orders.slice(0, limit);
  }

  // ────── 快捷买入比例 ──────
  function getBuyCapacity(symbol, ratio = 1.0) {
    const sim = Simulator.get(symbol);
    const price = sim.getPrice();
    const estFee = calcFee('buy', price, 100).total;
    const maxSpend = account.cash * ratio;
    const affordable = Math.floor((maxSpend - estFee) / price / 100) * 100;
    return Math.max(0, affordable);
  }

  // ────── SL/TP 检查 ──────
  /**
   * 每个 tick 调用，检查是否触发止损止盈
   * @returns {Array} 触发的订单列表
   */
  function checkSLTP() {
    const triggered = [];
    const remaining = [];

    for (const order of pendingOrders) {
      const sim = Simulator.get(order.symbol);
      const price = sim.getPrice();
      let hit = false;
      let reason = '';

      if (order.tpPrice && price >= order.tpPrice) {
        hit = true;
        reason = `止盈触发！现价 ¥${price.toFixed(2)} ≥ 止盈价 ¥${order.tpPrice.toFixed(2)}`;
      } else if (order.slPrice && price <= order.slPrice) {
        hit = true;
        reason = `止损触发！现价 ¥${price.toFixed(2)} ≤ 止损价 ¥${order.slPrice.toFixed(2)}`;
      }

      if (hit) {
        // 自动卖出
        const result = placeOrder(order.symbol, 'sell', order.shares);
        triggered.push({ order, reason, result });
      } else {
        remaining.push(order);
      }
    }

    pendingOrders = remaining;
    return triggered;
  }

  function getPendingOrders() {
    return [...pendingOrders];
  }

  // ────── 限价单 / 止损单 / 括号单 ──────

  /**
   * 下限价单：价格达到 limitPrice 时成交
   * @param {string} symbol
   * @param {string} side - 'buy' | 'sell'
   * @param {number} shares
   * @param {number} limitPrice - 限价
   * @param {object} opts - { slPrice?, tpPrice? }
   */
  function placeLimitOrder(symbol, side, shares, limitPrice, opts) {
    shares = Math.floor(shares / 100) * 100;
    if (shares < 100) return { success: false, message: '最小交易单位为100股' };
    if (!limitPrice || limitPrice <= 0) return { success: false, message: '请设置有效的限价' };

    var order = {
      id: ++orderIdCounter,
      type: 'limit',
      symbol: symbol,
      side: side,
      shares: shares,
      limitPrice: limitPrice,
      slPrice: (opts && opts.slPrice) || null,
      tpPrice: (opts && opts.tpPrice) || null,
      createdAt: Date.now()
    };
    orderBook.push(order);
    notify('orderbook', { action: 'added', order: order });
    return { success: true, message: '限价单已挂出 #' + order.id, order: order };
  }

  /**
   * 下止损单：价格触及 stopPrice 时触发市价单
   * @param {string} symbol
   * @param {string} side - 'buy' | 'sell'
   * @param {number} shares
   * @param {number} stopPrice - 触发价
   * @param {object} opts - { slPrice?, tpPrice? }
   */
  function placeStopOrder(symbol, side, shares, stopPrice, opts) {
    shares = Math.floor(shares / 100) * 100;
    if (shares < 100) return { success: false, message: '最小交易单位为100股' };
    if (!stopPrice || stopPrice <= 0) return { success: false, message: '请设置有效的止损触发价' };

    var order = {
      id: ++orderIdCounter,
      type: 'stop',
      symbol: symbol,
      side: side,
      shares: shares,
      stopPrice: stopPrice,
      slPrice: (opts && opts.slPrice) || null,
      tpPrice: (opts && opts.tpPrice) || null,
      createdAt: Date.now()
    };
    orderBook.push(order);
    notify('orderbook', { action: 'added', order: order });
    return { success: true, message: '止损单已挂出 #' + order.id, order: order };
  }

  /**
   * 下括号单 (OCO: One-Cancels-Other)
   * 入场后同时挂止盈和止损，一方触发则另一方取消
   * @param {string} symbol
   * @param {string} side - 'buy' | 'sell'（入场方向）
   * @param {number} shares
   * @param {number} entryPrice - 入场触发价（通常是现价附近）
   * @param {number} tpPrice - 止盈价
   * @param {number} slPrice - 止损价
   */
  function placeBracketOrder(symbol, side, shares, entryPrice, tpPrice, slPrice) {
    shares = Math.floor(shares / 100) * 100;
    if (shares < 100) return { success: false, message: '最小交易单位为100股' };
    if (!entryPrice || entryPrice <= 0) return { success: false, message: '请设置入场价' };
    if (!tpPrice || !slPrice) return { success: false, message: '请设置止盈价和止损价' };

    // 验证价格逻辑
    if (side === 'buy') {
      if (tpPrice <= entryPrice || slPrice >= entryPrice) {
        return { success: false, message: '买入括号单：止盈价应高于入场价，止损价应低于入场价' };
      }
    } else {
      if (tpPrice >= entryPrice || slPrice <= entryPrice) {
        return { success: false, message: '卖出括号单：止盈价应低于入场价，止损价应高于入场价' };
      }
    }

    var order = {
      id: ++orderIdCounter,
      type: 'bracket',
      symbol: symbol,
      side: side,
      shares: shares,
      entryPrice: entryPrice,
      tpPrice: tpPrice,
      slPrice: slPrice,
      createdAt: Date.now()
    };
    orderBook.push(order);
    notify('orderbook', { action: 'added', order: order });
    return { success: true, message: '括号单已挂出 #' + order.id + ' (入场 '+entryPrice.toFixed(2)+' TP '+tpPrice.toFixed(2)+' SL '+slPrice.toFixed(2)+')', order: order };
  }

  /**
   * 每个 tick 检查委托订单簿，触发满足条件的订单
   * @returns {Array} 触发的订单列表 [{ order, reason, result }]
   */
  function checkOrderBook() {
    var triggered = [];
    var remaining = [];

    for (var i = 0; i < orderBook.length; i++) {
      var order = orderBook[i];
      var sim = Simulator.get(order.symbol);
      var price = sim.getPrice();
      var hit = false;
      var reason = '';

      if (order.type === 'limit') {
        // 限价买单：价格 <= 限价时成交
        if (order.side === 'buy' && price <= order.limitPrice) {
          hit = true;
          reason = '限价买单触发 #' + order.id + ': 现价 ' + price.toFixed(2) + ' <= ' + order.limitPrice.toFixed(2);
        }
        // 限价卖单：价格 >= 限价时成交
        if (order.side === 'sell' && price >= order.limitPrice) {
          hit = true;
          reason = '限价卖单触发 #' + order.id + ': 现价 ' + price.toFixed(2) + ' >= ' + order.limitPrice.toFixed(2);
        }
      } else if (order.type === 'stop') {
        // 止损买单：价格 >= 触发价时买入（追涨）
        if (order.side === 'buy' && price >= order.stopPrice) {
          hit = true;
          reason = '止损买单触发 #' + order.id + ': 现价 ' + price.toFixed(2) + ' >= ' + order.stopPrice.toFixed(2);
        }
        // 止损卖单：价格 <= 触发价时卖出（杀跌）
        if (order.side === 'sell' && price <= order.stopPrice) {
          hit = true;
          reason = '止损卖单触发 #' + order.id + ': 现价 ' + price.toFixed(2) + ' <= ' + order.stopPrice.toFixed(2);
        }
      } else if (order.type === 'bracket') {
        // 括号单：先检查入场
        if (order.side === 'buy' && price <= order.entryPrice) {
          hit = true;
          reason = '括号单入场触发 #' + order.id + ': 买入 ' + order.symbol + ' @ ' + price.toFixed(2);
        } else if (order.side === 'sell' && price >= order.entryPrice) {
          hit = true;
          reason = '括号单入场触发 #' + order.id + ': 卖出 ' + order.symbol + ' @ ' + price.toFixed(2);
        }
      }

      if (hit) {
        var result;
        if (order.type === 'bracket') {
          // 括号单：执行入场，并设置 SL/TP
          result = placeOrder(order.symbol, order.side, order.shares, {
            slPrice: order.slPrice,
            tpPrice: order.tpPrice
          });
        } else if (order.type === 'limit' || order.type === 'stop') {
          // 限价单/止损单：以市价执行
          result = placeOrder(order.symbol, order.side, order.shares, {
            slPrice: order.slPrice,
            tpPrice: order.tpPrice
          });
        }
        triggered.push({ order: order, reason: reason, result: result });
        // 括号单触发后，另一腿由 SL/TP 机制处理，无需额外操作
      } else {
        remaining.push(order);
      }
    }

    orderBook = remaining;
    if (triggered.length > 0) {
      notify('orderbook', { action: 'triggered', triggered: triggered });
    }
    return triggered;
  }

  /**
   * 取消委托单
   * @param {number} orderId
   * @returns {object} { success, message }
   */
  function cancelOrder(orderId) {
    var idx = -1;
    for (var i = 0; i < orderBook.length; i++) {
      if (orderBook[i].id === orderId) { idx = i; break; }
    }
    if (idx >= 0) {
      var removed = orderBook.splice(idx, 1)[0];
      notify('orderbook', { action: 'cancelled', order: removed });
      return { success: true, message: '委托单 #' + orderId + ' 已取消' };
    }
    return { success: false, message: '未找到委托单 #' + orderId };
  }

  /**
   * 获取所有委托订单簿
   * @returns {Array}
   */
  function getOrderBook() {
    return orderBook.slice();
  }

  // ────── 持久化 ──────
  const STORAGE_KEY = 'kline_account';

  function save() {
    try {
      const data = {
        cash: account.cash,
        initialCapital: account.initialCapital,
        positions: account.positions,
        trades: account.trades.slice(-100),   // 保留最近100条
        pendingOrders,
        orderBook: orderBook.slice(-50),       // 保留最近50条委托
        orderIdCounter: orderIdCounter,
        savedAt: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e) { /* quota exceeded, ignore */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      account.cash = data.cash || account.initialCapital;
      account.initialCapital = data.initialCapital || account.initialCapital;
      account.positions = data.positions || {};
      account.trades = data.trades || [];
      pendingOrders = data.pendingOrders || [];
      orderBook = data.orderBook || [];
      orderIdCounter = data.orderIdCounter || 1000;
      return true;
    } catch(e) { return false; }
  }

  // ────── 重置 ──────
  function reset() {
    account.cash = account.initialCapital;
    account.positions = {};
    account.trades = [];
    account.orders = [];
    pendingOrders = [];
    orderBook = [];
    orderIdCounter = 1000;
    notify('account', getSummary());
  }

  function setCapital(amount) {
    account.initialCapital = amount;
    account.cash = amount;
    account.positions = {};
    account.trades = [];
    account.orders = [];
    orderBook = [];
    orderIdCounter = 1000;
    notify('account', getSummary());
  }

  function onUpdate(fn) { listeners.push(fn); }

  // ────── Public API ──────
  return {
    placeOrder,
    calculateMarketImpact,
    calcFee,
    getPositionInfo,
    getAllPositions,
    getSummary,
    getTrades,
    getOrders,
    getBuyCapacity,
    reset,
    setCapital,
    checkSLTP,
    getPendingOrders,
    placeLimitOrder,
    placeStopOrder,
    placeBracketOrder,
    checkOrderBook,
    cancelOrder,
    getOrderBook,
    save,
    load,
    onUpdate,
    FEE,
  };
})();
