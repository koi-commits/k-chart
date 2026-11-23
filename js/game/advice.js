/* ============================================
   advice.js — 结算页的预设文案（纯数据，不含逻辑）
   逻辑（scoring.js 的 diagnose）只返回"最大丢分项"的 key，界面按 key 到这里取文案。
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameAdvice = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  /** 最大丢分项 → 名称（用在"本局最大的丢分项是……"） */
  const DRAG_NAME = {
    quarter: '季度分',
    final: '终局分',
    drawdown: '回撤扣分',
    none: '没有明显的丢分项'
  };

  /** 与最大丢分项对应的一句话建议 */
  const ADVICE = {
    quarter: '把精力放在"每个季度都不要输给基准"上：这一季度没把握时，宁可降到接近基准的持仓，也别重仓赌一个方向。',
    final: '全程跑输基准的主要原因往往是买了没研究过的公司或持有过期估值：先研究再下大单，估值快过期时先重新研究。',
    drawdown: '回撤只看相对基准的回落：不要在基准上涨时空仓或把仓位压在单一公司上；一旦相对基准连续走弱，就降低仓位、分散持有。',
    none: '各项都没有明显丢分，继续保持"先研究、再下单、控制仓位"的节奏，争取每个季度都跑赢基准。'
  };

  /** 反事实对照的句式（{…} 由界面用本局实际数值填入） */
  const COUNTERFACTUAL = {
    drawdown: '若最大超额回撤为 {dd}（不超过扣分线），总分为 {total}，等级为 {grade}',
    quarter: '若第 {q} 季度跑平基准（超额 0 点），总分为 {total}，等级为 {grade}',
    final: '若全局超额收益为 0（只跑平基准），总分为 {total}，等级为 {grade}'
  };

  const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));

  return { DRAG_NAME, ADVICE, COUNTERFACTUAL, fill };
});
