/* ============================================
   events.js — 10 张事件卡（纯数据 + 抽取/结算）
   效果 = 修改某公司或某行业的 V（乘数）或 s（情绪加成）。
   新闻只给方向性线索，不给数值；数值在抽取时才随机决定。
   kind: 'fundamental' 改变真实价值；'sentiment' 只改变情绪（会回归）
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
  else root.GameEvents = factory(root.GameConfig);
})(typeof self !== 'undefined' ? self : this, function (GameConfig) {

  // vMult / sShift 为 [min, max] 区间，仅内部使用，不会展示给玩家
  const CARDS = [
    { id: 'earn_beat',   scope: 'company',  kind: 'fundamental', weight: 1.0, vMult: [1.06, 1.12], sShift: [0, 0.02],
      headline: '{name}发布业绩预告，核心经营数据好于市场预期' },
    { id: 'earn_miss',   scope: 'company',  kind: 'fundamental', weight: 1.0, vMult: [0.86, 0.93], sShift: [-0.02, 0],
      headline: '{name}披露主营业务利润下滑，管理层承认经营承压' },
    { id: 'big_order',   scope: 'company',  kind: 'fundamental', weight: 0.8, vMult: [1.04, 1.09], sShift: [0, 0.02],
      headline: '{name}公告签下大额长期订单，具体金额未披露' },
    { id: 'insider_sell', scope: 'company', kind: 'sentiment',   weight: 0.8, vMult: [0.99, 1.0], sShift: [-0.09, -0.04],
      headline: '{name}大股东计划减持，市场情绪转谨慎，公司称经营一切正常' },
    { id: 'rumor_hype',  scope: 'company',  kind: 'sentiment',   weight: 1.0, vMult: [1.0, 1.0], sShift: [0.06, 0.12],
      headline: '市场流传{name}将有重大资产重组，公司未予证实' },
    { id: 'policy_up',   scope: 'industry', kind: 'fundamental', weight: 0.8, vMult: [1.04, 1.08], sShift: [0.01, 0.03],
      headline: '监管部门发文支持{industry}行业发展，细则有待出台' },
    { id: 'policy_down', scope: 'industry', kind: 'fundamental', weight: 0.8, vMult: [0.92, 0.96], sShift: [-0.03, -0.01],
      headline: '{industry}行业迎来更严监管，部分业务面临整改' },
    { id: 'demand_up',   scope: 'industry', kind: 'fundamental', weight: 0.7, vMult: [1.02, 1.06], sShift: [0, 0.02],
      headline: '多家机构调研显示{industry}行业需求边际回暖' },
    { id: 'sector_hype', scope: 'industry', kind: 'sentiment',   weight: 0.9, vMult: [1.0, 1.0], sShift: [0.04, 0.09],
      headline: '{industry}板块获资金追捧，多只个股异动，行业基本面无明显变化' },
    { id: 'refinance',   scope: 'company',  kind: 'fundamental', weight: 0.7, vMult: [0.90, 0.95], sShift: [-0.04, -0.01],
      headline: '{name}再融资成本上升，债务压力引发市场担忧' }
  ];

  function fill(tpl, company) {
    return tpl.replace('{name}', company.name).replace('{industry}', company.industryName);
  }

  function weightedPick(rng, cards) {
    const total = cards.reduce((a, c) => a + c.weight, 0);
    let r = rng.next() * total;
    for (const c of cards) { r -= c.weight; if (r <= 0) return c; }
    return cards[cards.length - 1];
  }

  /**
   * 抽取本周事件并结算为具体数值。
   * @param rng  events 随机流
   * @param companies  { id: {id,name,industry,industryName,debt} }（顺序 = 对象键顺序）
   * @returns [{cardId, headline, targetId, effects:{companyId:{vLog,sShift}}}]
   */
  function drawWeek(rng, companies) {
    const cfg = GameConfig.events;
    let n = 0;
    if (rng.chance(cfg.firstProb)) { n = 1; if (rng.chance(cfg.secondProb)) n = 2; }
    const list = Object.values(companies);
    const pool = CARDS.slice();
    const out = [];
    for (let i = 0; i < n; i++) {
      const card = weightedPick(rng, pool);
      pool.splice(pool.indexOf(card), 1);          // 同一周不重复同一张卡
      const target = rng.pick(list);               // 公司事件：该公司；行业事件：该公司所在行业
      const hit = card.scope === 'company' ? [target] : list.filter((c) => c.industry === target.industry);
      const effects = {};
      const lnMult = Math.log(rng.uniform(card.vMult[0], card.vMult[1]));
      const sShift = rng.uniform(card.sShift[0], card.sShift[1]);
      for (const c of hit) {
        const leverage = 1 + cfg.debtLeverage * c.debt;  // 负债越高，基本面冲击越大
        effects[c.id] = { vLog: lnMult * leverage, sShift };
      }
      out.push({ cardId: card.id, kind: card.kind, headline: fill(card.headline, target), targetId: target.id, effects });
    }
    return out;
  }

  return { CARDS, drawWeek };
});
