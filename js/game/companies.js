/* ============================================
   companies.js — 4 家虚构公司（4 个行业各 1 家）
   隐藏属性：真实价值 V、增长率、波动率、负债水平
   玩家永远看不到这些数字（只能通过研究得到 V 的估计）
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameCompanies = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const DEFS = [
    { id: 'jzjy', name: '金樽酒业', industry: 'liquor',   industryName: '白酒',
      v0: 120, growth: 0.08, vol: 0.010, debt: 0.15, adv: 2000000 },
    { id: 'gcxn', name: '光储新能', industry: 'newenergy', industryName: '新能源',
      v0: 45,  growth: 0.25, vol: 0.016, debt: 0.45, adv: 4000000 },
    { id: 'hydc', name: '华岳地产', industry: 'realestate', industryName: '地产',
      v0: 18,  growth: -0.04, vol: 0.014, debt: 0.85, adv: 6000000 },
    { id: 'xhkj', name: '芯海科技', industry: 'semi',     industryName: '半导体',
      v0: 70,  growth: 0.15, vol: 0.018, debt: 0.30, adv: 3000000 }
  ];

  /** 返回公司定义的深拷贝（初始 V 的抖动由 game-state 用种子决定） */
  function getDefs() { return DEFS.map((d) => Object.assign({}, d)); }
  function ids() { return DEFS.map((d) => d.id); }

  return { getDefs, ids };
});
