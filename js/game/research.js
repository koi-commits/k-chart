/* ============================================
   research.js — 研究点：花点数得到公司 V 的估计
   · 每回合 3 点；对同一公司投入越多，误差越小
   · σ(n) = baseError × errorDecay^(n-1)  （ln V 的标准差）
   · 估计 4 回合后过期；新研究覆盖旧估计
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'), require('./rng.js'));
  else root.GameResearch = factory(root.GameConfig, root.GameRng);
})(typeof self !== 'undefined' ? self : this, function (GameConfig, GameRng) {
  const R = GameConfig.research;

  function sigmaFor(points) { return R.baseError * Math.pow(R.errorDecay, points - 1); }

  /**
   * 纯函数：对公司 id 投入 points 点研究，返回新 state。
   * 点数不足/非法时返回 { state: 原 state, error }。
   */
  function research(state, id, points) {
    points = Math.floor(points);
    if (state.status !== 'playing') return { state, error: '游戏已结束' };
    if (!state.companies[id]) return { state, error: '未知公司' };
    if (!(points >= 1)) return { state, error: '至少投入 1 点' };
    if (points > state.pointsLeft) return { state, error: '研究点不足' };

    const next = JSON.parse(JSON.stringify(state));
    const rng = GameRng.create(next.rng.research);
    const sigma = sigmaFor(points);
    const estimate = next.companies[id].V * Math.exp(sigma * rng.normal());
    next.rng.research = rng.state();
    next.pointsLeft -= points;
    next.research[id] = { estimate: Math.round(estimate * 100) / 100, turn: next.turn, points, sigma };
    return { state: next };
  }

  /** 当前有效估计：{estimate, points, sigma, age, remaining}，过期/没有则 null */
  function getEstimate(state, id) {
    const r = state.research[id];
    if (!r) return null;
    const age = state.turn - r.turn;
    if (age >= R.validTurns) return null;
    return { estimate: r.estimate, points: r.points, sigma: r.sigma, age, remaining: R.validTurns - age };
  }

  return { research, getEstimate, sigmaFor };
});
