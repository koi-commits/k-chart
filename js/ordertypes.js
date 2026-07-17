/* ============================================
   ordertypes.js — 扩展订单类型
   支持限价单、止损单、OCO（括号）订单
   localStorage 持久化，每 tick 自动检查触发
   ============================================ */

const OrderManager = (() => {

  // ────── 内部状态 ──────
  var pendingOrders = [];    // 待触发订单
  var filledOrders = [];     // 今日已成交订单
  var orderCounter = 0;      // 订单ID计数器
  var fillCallbacks = [];    // 成交回调

  var STORAGE_KEY_PENDING = 'kline_pending_orders';
  var STORAGE_KEY_FILLED = 'kline_filled_orders';
  var STORAGE_KEY_COUNTER = 'kline_order_counter';

  // ────── 工具函数 ──────
  function generateId() {
    orderCounter++;
    return 'ord_' + Date.now().toString(36) + '_' + orderCounter;
  }

  function now() {
    return Date.now();
  }

  // 检查交易数量是否合法（A股：100股=1手，最小1手）
  function isValidShares(shares) {
    return shares >= 100 && shares % 100 === 0;
  }

  // ────── 下订单 ──────

  /**
   * 下限价单
   * @param {string} symbol - 股票代码
   * @param {string} side - 'buy' | 'sell'
   * @param {number} price - 限价价格
   * @param {number} shares - 股数（100的整数倍）
   * @returns {object} { success, order?, message }
   */
  function placeLimit(symbol, side, price, shares) {
    try {
      if (!Simulator.STOCKS[symbol]) {
        return { success: false, message: '未知股票代码: ' + symbol };
      }
      if (side !== 'buy' && side !== 'sell') {
        return { success: false, message: '方向必须为 buy 或 sell' };
      }
      if (!isValidShares(shares)) {
        return { success: false, message: '股数必须为100的整数倍，最少100股' };
      }
      if (!price || price <= 0) {
        return { success: false, message: '限价必须大于0' };
      }

      var order = {
        id: generateId(),
        symbol: symbol,
        side: side,
        type: 'limit',
        status: 'pending',
        price: +price.toFixed(2),
        shares: shares,
        createdAt: now(),
      };

      pendingOrders.push(order);
      save();
      return { success: true, order: order, message: '限价单已挂出' };
    } catch(e) {
      console.warn('[OrderManager] placeLimit error: ' + e.message);
      return { success: false, message: e.message };
    }
  }

  /**
   * 下止损单
   * @param {string} symbol - 股票代码
   * @param {string} side - 'buy' | 'sell'
   * @param {number} triggerPrice - 触发价格
   * @param {number} shares - 股数
   * @returns {object} { success, order?, message }
   */
  function placeStop(symbol, side, triggerPrice, shares) {
    try {
      if (!Simulator.STOCKS[symbol]) {
        return { success: false, message: '未知股票代码: ' + symbol };
      }
      if (side !== 'buy' && side !== 'sell') {
        return { success: false, message: '方向必须为 buy 或 sell' };
      }
      if (!isValidShares(shares)) {
        return { success: false, message: '股数必须为100的整数倍，最少100股' };
      }
      if (!triggerPrice || triggerPrice <= 0) {
        return { success: false, message: '触发价必须大于0' };
      }

      var order = {
        id: generateId(),
        symbol: symbol,
        side: side,
        type: 'stop',
        status: 'pending',
        triggerPrice: +triggerPrice.toFixed(2),
        shares: shares,
        createdAt: now(),
      };

      pendingOrders.push(order);
      save();
      return { success: true, order: order, message: '止损单已挂出' };
    } catch(e) {
      console.warn('[OrderManager] placeStop error: ' + e.message);
      return { success: false, message: e.message };
    }
  }

  /**
   * 下OCO订单（同时设置止盈和止损）
   * @param {string} symbol - 股票代码
   * @param {string} side - 当前仅支持卖出OCO（'sell'）
   * @param {number} shares - 股数
   * @param {number} tpPrice - 止盈价
   * @param {number} slPrice - 止损价
   * @returns {object} { success, order?, message }
   */
  function placeOCO(symbol, side, shares, tpPrice, slPrice) {
    try {
      if (!Simulator.STOCKS[symbol]) {
        return { success: false, message: '未知股票代码: ' + symbol };
      }
      if (!isValidShares(shares)) {
        return { success: false, message: '股数必须为100的整数倍，最少100股' };
      }
      if (!tpPrice || tpPrice <= 0) {
        return { success: false, message: '止盈价必须大于0' };
      }
      if (!slPrice || slPrice <= 0) {
        return { success: false, message: '止损价必须大于0' };
      }
      if (side === 'buy') {
        // 买入OCO暂时不常用，但保留能力
        if (tpPrice <= slPrice) {
          return { success: false, message: '对于买入OCO，止盈价应高于止损价' };
        }
      } else {
        // 卖出OCO：止盈价 > 止损价
        if (tpPrice <= slPrice) {
          return { success: false, message: '止盈价必须高于止损价' };
        }
        // 验证持仓
        if (typeof Trader !== 'undefined' && Trader.getPositionInfo) {
          var pos = Trader.getPositionInfo(symbol);
          if (!pos || pos.shares < shares) {
            var held = pos ? pos.shares : 0;
            return { success: false, message: '持仓不足！持有 ' + held + ' 股，需要 ' + shares + ' 股' };
          }
        }
      }

      var order = {
        id: generateId(),
        symbol: symbol,
        side: side,
        type: 'oco',
        status: 'pending',
        shares: shares,
        tpPrice: +tpPrice.toFixed(2),
        slPrice: +slPrice.toFixed(2),
        ocoStatus: null,  // null | 'tp_triggered' | 'sl_triggered'
        createdAt: now(),
      };

      pendingOrders.push(order);
      save();
      return { success: true, order: order, message: 'OCO订单已挂出' };
    } catch(e) {
      console.warn('[OrderManager] placeOCO error: ' + e.message);
      return { success: false, message: e.message };
    }
  }

  // ────── 订单检查与触发 ──────

  /**
   * 获取当前股票价格
   */
  function getCurrentPrice(symbol) {
    try {
      if (typeof Simulator !== 'undefined') {
        var sim = Simulator.get(symbol);
        return sim.getPrice();
      }
      return 0;
    } catch(e) { return 0; }
  }

  /**
   * 执行订单成交
   * @param {object} order - 订单对象
   * @param {number} fillPrice - 成交价格
   */
  function executeFill(order, fillPrice) {
    try {
      var fillOrder = {
        id: order.id,
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        fillPrice: +fillPrice.toFixed(2),
        shares: order.shares,
        orderPrice: order.price || order.triggerPrice || null,
        ocoStatus: order.ocoStatus || null,
        filledAt: now()
      };

      // 调用 Trader 执行实际交易
      if (typeof Trader !== 'undefined' && Trader.placeOrder) {
        var result = Trader.placeOrder(order.symbol, order.side, order.shares);
        if (result.success) {
          fillOrder.tradeResult = result;
          filledOrders.push(fillOrder);
          order.status = 'filled';

          // 触发回调
          for (var i = 0; i < fillCallbacks.length; i++) {
            try {
              fillCallbacks[i]({
                order: fillOrder,
                fillPrice: fillPrice,
                time: now()
              });
            } catch(cbErr) {}
          }
        } else {
          // 如果Trader拒绝（如资金不足），订单仍保留为pending
          console.warn('[OrderManager] 成交失败: ' + result.message);
          return false;
        }
      } else {
        // 没有Trader时也记录（测试环境）
        filledOrders.push(fillOrder);
        order.status = 'filled';
      }

      return true;
    } catch(e) {
      console.warn('[OrderManager] executeFill error: ' + e.message);
      return false;
    }
  }

  /**
   * 每个tick调用，检查是否有订单触发
   * @param {number} currentPrice - 当前价格（可选，不传则自动从Simulator获取）
   * @returns {Array} 本次触发的订单列表
   */
  function check(currentPrice) {
    try {
      var triggered = [];
      var remaining = [];

      for (var i = 0; i < pendingOrders.length; i++) {
        var order = pendingOrders[i];
        var price = typeof currentPrice === 'number'
          ? currentPrice
          : getCurrentPrice(order.symbol);

        if (!price || price <= 0) {
          remaining.push(order);
          continue;
        }

        var filled = false;

        // ── 限价单 ──
        if (order.type === 'limit') {
          if (order.side === 'buy' && price <= order.price) {
            // 价格 ≤ 买入限价 → 以限价成交
            filled = executeFill(order, order.price);
          } else if (order.side === 'sell' && price >= order.price) {
            // 价格 ≥ 卖出限价 → 以限价成交
            filled = executeFill(order, order.price);
          }
        }

        // ── 止损单 ──
        if (order.type === 'stop') {
          if (order.side === 'buy' && price >= order.triggerPrice) {
            filled = executeFill(order, price);
          } else if (order.side === 'sell' && price <= order.triggerPrice) {
            filled = executeFill(order, price);
          }
        }

        // ── OCO 订单 ──
        if (order.type === 'oco') {
          // 卖出OCO：止盈触发 (价 >= tpPrice) 或 止损触发 (价 <= slPrice)
          if (order.side === 'sell') {
            if (price >= order.tpPrice) {
              order.ocoStatus = 'tp_triggered';
              filled = executeFill(order, order.tpPrice);
            } else if (price <= order.slPrice) {
              order.ocoStatus = 'sl_triggered';
              filled = executeFill(order, order.slPrice);
            }
          } else {
            // 买入OCO（较少使用）
            if (price <= order.tpPrice) {
              order.ocoStatus = 'tp_triggered';
              filled = executeFill(order, order.tpPrice);
            } else if (price >= order.slPrice) {
              order.ocoStatus = 'sl_triggered';
              filled = executeFill(order, order.slPrice);
            }
          }
        }

        if (filled) {
          triggered.push(order);
        } else {
          remaining.push(order);
        }
      }

      pendingOrders = remaining;

      // 如果有成交，持久化
      if (triggered.length > 0) {
        save();
      }

      return triggered;
    } catch(e) {
      console.warn('[OrderManager] check error: ' + e.message);
      return [];
    }
  }

  // ────── 查询接口 ──────

  /**
   * 获取所有待触发订单
   * @returns {Array}
   */
  function getPending() {
    return pendingOrders.slice();
  }

  /**
   * 取消指定订单
   * @param {string} orderId - 订单ID
   * @returns {boolean} 是否成功取消
   */
  function cancel(orderId) {
    try {
      var found = false;
      var remaining = [];
      for (var i = 0; i < pendingOrders.length; i++) {
        if (pendingOrders[i].id === orderId) {
          pendingOrders[i].status = 'cancelled';
          // 存入已填充列表（标记为取消）
          filledOrders.push({
            id: pendingOrders[i].id,
            symbol: pendingOrders[i].symbol,
            cancelled: true,
            cancelledAt: now()
          });
          found = true;
        } else {
          remaining.push(pendingOrders[i]);
        }
      }
      pendingOrders = remaining;
      if (found) save();
      return found;
    } catch(e) {
      console.warn('[OrderManager] cancel error: ' + e.message);
      return false;
    }
  }

  /**
   * 取消所有待触发订单
   * @returns {number} 取消的订单数量
   */
  function cancelAll() {
    try {
      var count = pendingOrders.length;
      for (var i = 0; i < pendingOrders.length; i++) {
        pendingOrders[i].status = 'cancelled';
      }
      pendingOrders = [];
      save();
      return count;
    } catch(e) {
      console.warn('[OrderManager] cancelAll error: ' + e.message);
      return 0;
    }
  }

  /**
   * 获取今日已成交（含取消）订单
   * @returns {Array}
   */
  function getFilledToday() {
    return filledOrders.slice();
  }

  /**
   * 获取订单线信息（用于在图表上显示水平虚线）
   * 每个待触发订单返回一条线的描述
   * @returns {Array} [{price, type, label, orderId}]
   */
  function getOrderLines() {
    try {
      var lines = [];
      for (var i = 0; i < pendingOrders.length; i++) {
        var order = pendingOrders[i];
        var lineInfo = {
          orderId: order.id,
          symbol: order.symbol
        };

        if (order.type === 'limit') {
          lineInfo.price = order.price;
          lineInfo.type = 'limit';
          lineInfo.label = (order.side === 'buy' ? '买' : '卖') + '限 ' + order.price.toFixed(2);
        } else if (order.type === 'stop') {
          lineInfo.price = order.triggerPrice;
          lineInfo.type = 'stop';
          lineInfo.label = (order.side === 'buy' ? '买' : '卖') + '止 ' + order.triggerPrice.toFixed(2);
        } else if (order.type === 'oco') {
          // OCO 返回两条线
          lines.push({
            orderId: order.id,
            symbol: order.symbol,
            price: order.tpPrice,
            type: 'oco_tp',
            label: '止盈 ' + order.tpPrice.toFixed(2)
          });
          lineInfo = {
            orderId: order.id,
            symbol: order.symbol,
            price: order.slPrice,
            type: 'oco_sl',
            label: '止损 ' + order.slPrice.toFixed(2)
          };
        }

        lines.push(lineInfo);
      }
      return lines;
    } catch(e) {
      console.warn('[OrderManager] getOrderLines error: ' + e.message);
      return [];
    }
  }

  // ────── 回调注册 ──────

  /**
   * 注册成交回调
   * @param {function} callback - function({order, fillPrice, time})
   */
  function onFill(callback) {
    if (typeof callback === 'function') {
      fillCallbacks.push(callback);
    }
  }

  // ────── 持久化 ──────

  function save() {
    try {
      var pendingData = pendingOrders.map(function(o) {
        var clone = {};
        for (var k in o) {
          if (o.hasOwnProperty(k)) clone[k] = o[k];
        }
        return clone;
      });
      localStorage.setItem(STORAGE_KEY_PENDING, JSON.stringify(pendingData));
      localStorage.setItem(STORAGE_KEY_FILLED, JSON.stringify(filledOrders.slice(-100)));
      localStorage.setItem(STORAGE_KEY_COUNTER, String(orderCounter));
    } catch(e) {
      console.warn('[OrderManager] save error: ' + e.message);
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY_PENDING);
      if (raw) {
        pendingOrders = JSON.parse(raw);
      }

      var rawFilled = localStorage.getItem(STORAGE_KEY_FILLED);
      if (rawFilled) {
        filledOrders = JSON.parse(rawFilled);
      }

      var rawCnt = localStorage.getItem(STORAGE_KEY_COUNTER);
      if (rawCnt) {
        orderCounter = parseInt(rawCnt) || 0;
      }

      // 清理已成交/取消的订单：只保留 status === 'pending' 的
      pendingOrders = pendingOrders.filter(function(o) {
        return o.status === 'pending' || !o.status;
      });

      return true;
    } catch(e) {
      console.warn('[OrderManager] load error: ' + e.message);
      return false;
    }
  }

  /**
   * 清除所有数据（模拟重置）
   */
  function reset() {
    pendingOrders = [];
    filledOrders = [];
    orderCounter = 0;
    save();
  }

  // ────── Public API ──────
  return {
    placeLimit: placeLimit,
    placeStop: placeStop,
    placeOCO: placeOCO,
    getPending: getPending,
    cancel: cancel,
    cancelAll: cancelAll,
    check: check,
    getFilledToday: getFilledToday,
    getOrderLines: getOrderLines,
    onFill: onFill,
    load: load,
    save: save,
    reset: reset
  };

})();
