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

  // vMult / sShift 为 [min, max] 区间，仅内部使用，不会展示给玩家。dir：对目标公司的方向（+1 利好 / -1 利空）。
  // 标题按事件强度分"重/轻"两档（强度由抽到的幅度决定），每档可有多个说法：
  //   · 重/轻的措辞本身带来区分度（"重大长期合同" vs "常规供货订单"），读一句就能大致判断重要程度，但不给数值；
  //   · 基本面与情绪事件刻意共用词汇（如"业绩""订单""传闻""利润下滑"），不存在单个关键词能 100% 判断类型；
  //   · 不再出现"公司称经营一切正常""基本面无明显变化"这类直接暴露类型的尾句。
  const CARDS = [
    { id: 'earn_beat',   scope: 'company',  kind: 'fundamental', dir: 1, weight: 1.0, vMult: [1.06, 1.12], sShift: [0, 0.02],
      strong: ['{name}业绩预告大幅超出市场预期，核心经营数据明显改善', '{name}披露业绩预告，主营业务利润显著增长'],
      weak:   ['{name}发布业绩预告，部分经营数据略好于市场预期'] },
    { id: 'earn_miss',   scope: 'company',  kind: 'fundamental', dir: -1, weight: 1.0, vMult: [0.86, 0.93], sShift: [-0.02, 0],
      strong: ['{name}披露主营业务利润大幅下滑，管理层坦言经营承压', '{name}业绩预告大幅低于市场预期，多项经营数据恶化'],
      weak:   ['{name}披露主营业务利润小幅回落，称属阶段性波动'] },
    { id: 'big_order',   scope: 'company',  kind: 'fundamental', dir: 1, weight: 0.8, vMult: [1.04, 1.09], sShift: [0, 0.02],
      strong: ['{name}公告签下重大长期合同，合同规模相当于上年营收的可观比例', '市场此前流传的{name}订单传闻获公司证实，合同已正式签署'],
      weak:   ['{name}公告签下常规供货订单，预计对当年业绩影响有限'] },
    { id: 'policy_up',   scope: 'industry', kind: 'fundamental', dir: 1, weight: 0.8, vMult: [1.04, 1.08], sShift: [0.01, 0.03],
      strong: ['监管部门出台{industry}行业扶持措施，覆盖多个核心环节'],
      weak:   ['监管部门发文表态支持{industry}行业，细则有待出台'] },
    { id: 'policy_down', scope: 'industry', kind: 'fundamental', dir: -1, weight: 0.8, vMult: [0.92, 0.96], sShift: [-0.03, -0.01],
      strong: ['{industry}行业迎来更严监管，多项主营业务面临整改'],
      weak:   ['{industry}行业监管口径趋严，部分企业需要调整业务'] },
    { id: 'demand_up',   scope: 'industry', kind: 'fundamental', dir: 1, weight: 0.7, vMult: [1.02, 1.06], sShift: [0, 0.02],
      strong: ['多家机构调研显示{industry}行业需求明显回暖，板块受到资金关注'],
      weak:   ['调研显示{industry}行业需求边际小幅回暖'] },
    { id: 'refinance',   scope: 'company',  kind: 'fundamental', dir: -1, weight: 0.7, vMult: [0.90, 0.95], sShift: [-0.04, -0.01],
      strong: ['{name}再融资成本明显上升，债务压力引发市场担忧'],
      weak:   ['{name}再融资利率小幅上行，市场关注其偿债安排'] },
    { id: 'insider_sell', scope: 'company', kind: 'sentiment',   dir: -1, weight: 0.8, vMult: [0.99, 1.0], sShift: [-0.09, -0.04],
      strong: ['{name}多位股东披露减持计划，二级市场抛压明显', '市场传言{name}主营业务利润将大幅下滑，公司暂无公告'],
      weak:   ['{name}一位股东拟减持少量股份，市场情绪转谨慎'] },
    { id: 'rumor_hype',  scope: 'company',  kind: 'sentiment',   dir: 1, weight: 1.0, vMult: [1.0, 1.0], sShift: [0.06, 0.12],
      strong: ['市场流传{name}将有重大资产重组，公司未予证实', '市场传言{name}业绩将大幅超预期，公司暂无公告'],
      weak:   ['多家自媒体看好{name}，称其有望受益于行业变化'] },
    { id: 'sector_hype', scope: 'industry', kind: 'sentiment',   dir: 1, weight: 0.9, vMult: [1.0, 1.0], sShift: [0.04, 0.09],
      strong: ['{industry}板块获资金追捧，多只个股连续涨停'],
      weak:   ['{industry}板块成交活跃，多只个股异动', '多家券商看多{industry}行业，称景气度有望继续上行'] }
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
   * 同一周同一家公司不会同时出现方向相反的两条新闻：第 2 条若与第 1 条在同一公司上方向相反，重抽（最多 8 次），仍冲突则本周只有 1 条。
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
    const out = [], dirs = {};       // dirs: 本周已出现的 公司id → 方向
    for (let i = 0; i < n; i++) {
      let card = null, target = null, hit = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const c = weightedPick(rng, pool), tg = rng.pick(list);
        const h = c.scope === 'company' ? [tg] : list.filter((x) => x.industry === tg.industry);
        if (h.some((x) => dirs[x.id] && dirs[x.id] !== c.dir)) continue;   // 与本周已有新闻方向相反 → 重抽
        card = c; target = tg; hit = h; break;
      }
      if (!card) break;
      pool.splice(pool.indexOf(card), 1);          // 同一周不重复同一张卡
      const m = rng.uniform(card.vMult[0], card.vMult[1]);
      const lnMult = Math.log(m);
      const sShift = rng.uniform(card.sShift[0], card.sShift[1]);
      // 强度：基本面看 V 变化幅度，情绪看情绪冲击幅度；落在区间上半段为"重"，否则为"轻"
      const mag = card.kind === 'fundamental' ? Math.abs(lnMult) : Math.abs(sShift);
      const r = card.kind === 'fundamental' ? [Math.abs(Math.log(card.vMult[0])), Math.abs(Math.log(card.vMult[1]))] : [Math.abs(card.sShift[0]), Math.abs(card.sShift[1])];
      const strong = r[0] === r[1] ? true : (mag - Math.min(r[0], r[1])) / Math.abs(r[1] - r[0]) >= 0.5;
      const headline = fill(rng.pick(strong ? card.strong : card.weak), target);
      const effects = {};
      for (const c of hit) {
        const leverage = 1 + cfg.debtLeverage * c.debt;  // 负债越高，基本面冲击越大
        effects[c.id] = { vLog: lnMult * leverage, sShift };
        dirs[c.id] = card.dir;
      }
      out.push({ cardId: card.id, kind: card.kind, headline, targetId: target.id, effects });
    }
    return out;
  }

  return { CARDS, drawWeek };
});
