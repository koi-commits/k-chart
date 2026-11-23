/* ============================================
   companies.js — 4 家虚构公司（4 个行业各 1 家）
   隐藏属性：真实价值 V、增长率、波动率、负债水平
   玩家永远看不到这些数字（只能通过研究得到 V 的估计）
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
  else root.GameCompanies = factory(root.GameConfig);
})(typeof self !== 'undefined' ? self : this, function (GameConfig) {

  // 名称、行业、日均成交量固定；growth/vol/debt/v0 每局随机（范围见 config.industries）
  const DEFS = [
    { id: 'jzjy', name: '金樽酒业', industry: 'liquor',     industryName: '白酒',   adv: 2000000 },
    { id: 'gcxn', name: '光储新能', industry: 'newenergy',  industryName: '新能源', adv: 4000000 },
    { id: 'hydc', name: '华岳地产', industry: 'realestate', industryName: '地产',   adv: 6000000 },
    { id: 'xhkj', name: '芯海科技', industry: 'semi',       industryName: '半导体', adv: 3000000 }
  ];

  const r4 = (x) => Math.round(x * 10000) / 10000;

  /** 用 rng 为每家公司在行业范围内抽取 growth/vol/debt/v0（按 DEFS 顺序，保证确定性） */
  function generate(rng) {
    return DEFS.map((d) => {
      const rg = GameConfig.industries[d.industry];
      return Object.assign({}, d, {
        growth: r4(rng.uniform(rg.growth[0], rg.growth[1])),
        vol: r4(rng.uniform(rg.vol[0], rg.vol[1])),
        debt: r4(rng.uniform(rg.debt[0], rg.debt[1])),
        v0: Math.round(rng.uniform(rg.v0[0], rg.v0[1]) * 100) / 100
      });
    });
  }
  function ids() { return DEFS.map((d) => d.id); }

  return { generate, ids };
});
