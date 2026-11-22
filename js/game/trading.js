/* ============================================
   trading.js — 交易规则纯函数
   A股费率 + 平方根市场冲击 + T+1 + 涨跌停无法成交
   费率与冲击模型提取自旧 trader.js（去掉 Math.random 与全局账户状态）；
   T+1 与涨跌停成交限制为新增（旧 trader.js 里没有）。
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
  else root.GameTrading = factory(root.GameConfig);
})(typeof self !== 'undefined' ? self : this, function (GameConfig) {

  const r2 = (x) => Math.round(x * 100) / 100;
  const FEE = GameConfig.fees;
  const IMP = GameConfig.impact;

  function calcFee(side, price, shares) {
    const value = price * shares;
    const commission = Math.max(value * FEE.commissionRate, FEE.minCommission);
    const stampDuty = side === 'sell' ? value * FEE.stampDutyRate : 0;
    const transferFee = value * FEE.transferFeeRate;
    return {
      commission: r2(commission), stampDuty: r2(stampDuty), transferFee: r2(transferFee),
      total: r2(commission + stampDuty + transferFee)
    };
  }

  /**
   * 市场冲击：先吃五档盘口（深度 = 日均成交量 × 比例，逐档价差 0.1%），
   * 超出部分按平方根模型加额外滑点。
   * @returns {avgPrice, impactPct}
   */
  function marketImpact(side, shares, price, co) {
    const dir = side === 'buy' ? 1 : -1;
    let remaining = shares, cost = 0;
    for (let i = 0; i < IMP.levelDepthFractions.length && remaining > 0; i++) {
      const depth = Math.max(GameConfig.lotSize, Math.floor(co.adv * IMP.levelDepthFractions[i]));
      const fill = Math.min(remaining, depth);
      cost += fill * price * (1 + dir * i * IMP.levelStep);
      remaining -= fill;
    }
    if (remaining > 0) {
      const sqrtImpact = IMP.sqrtCoef * co.vol * Math.sqrt(shares / co.adv);
      cost += remaining * price * (1 + dir * (sqrtImpact + IMP.overflowExtra));
    }
    const avgPrice = cost / shares;
    return { avgPrice: r2(avgPrice), impactPct: ((avgPrice - price) / price) * dir * 100 };
  }

  /** 涨停买不进、跌停卖不出（以成交价相对昨收判断） */
  function limitBlock(side, price, prevClose) {
    const up = r2(prevClose * (1 + GameConfig.limitPct));
    const down = r2(prevClose * (1 - GameConfig.limitPct));
    if (side === 'buy' && price >= up) return '涨停，无法买入';
    if (side === 'sell' && price <= down) return '跌停，无法卖出';
    return null;
  }

  /** T+1：当日买入的股份当日不可卖 */
  function sellableShares(pos, day) {
    if (!pos) return 0;
    return pos.shares - (pos.boughtDay === day ? pos.boughtQty : 0);
  }

  function maxAffordable(cash, price) {
    const fee = calcFee('buy', price, GameConfig.lotSize).total;
    return Math.max(0, Math.floor((cash - fee) / price / GameConfig.lotSize) * GameConfig.lotSize);
  }

  /**
   * 执行一笔订单（纯函数）。
   * @param account {cash, positions:{id:{shares,avgCost,boughtDay,boughtQty}}}
   * @param order   {id, side:'buy'|'sell', shares}
   * @param ctx     {price(开盘价), prevClose, day, company:{vol,adv}}
   * @returns {account, trade} 成功；{account(原样), error} 失败
   */
  function executeOrder(account, order, ctx) {
    const lot = GameConfig.lotSize;
    const shares = Math.floor(order.shares / lot) * lot;
    if (!(shares >= lot)) return { account, error: '最小交易单位为 1 手（100 股）' };
    if (order.side !== 'buy' && order.side !== 'sell') return { account, error: '未知买卖方向' };

    const blocked = limitBlock(order.side, ctx.price, ctx.prevClose);
    if (blocked) return { account, error: blocked };

    const pos0 = account.positions[order.id];
    if (order.side === 'sell') {
      const can = sellableShares(pos0, ctx.day);
      if (shares > can) {
        return { account, error: can < (pos0 ? pos0.shares : 0) ? `T+1：当日买入不可卖出（可卖 ${can} 股）` : `持仓不足（可卖 ${can} 股）` };
      }
    }

    const impact = marketImpact(order.side, shares, ctx.price, ctx.company);
    const value = impact.avgPrice * shares;
    const fee = calcFee(order.side, impact.avgPrice, shares);

    const positions = Object.assign({}, account.positions);
    let cash = account.cash;

    if (order.side === 'buy') {
      if (value + fee.total > cash) return { account, error: '资金不足' };
      cash -= value + fee.total;
      const p = pos0 || { shares: 0, avgCost: 0, boughtDay: -1, boughtQty: 0 };
      const total = p.avgCost * p.shares + value;
      positions[order.id] = {
        shares: p.shares + shares,
        avgCost: total / (p.shares + shares),
        boughtDay: ctx.day,
        boughtQty: (p.boughtDay === ctx.day ? p.boughtQty : 0) + shares
      };
    } else {
      cash += value - fee.total;
      const left = pos0.shares - shares;
      if (left === 0) delete positions[order.id];
      else positions[order.id] = Object.assign({}, pos0, { shares: left });
    }

    return {
      account: { cash, positions },
      trade: { id: order.id, side: order.side, shares, price: impact.avgPrice, fee: fee.total, impactPct: impact.impactPct }
    };
  }

  return { calcFee, marketImpact, limitBlock, sellableShares, maxAffordable, executeOrder };
});
