/* ============================================
   rng.js — 可设种子的 PRNG（mulberry32）
   游戏逻辑中禁止直接调用 Math.random，一律用本模块。
   状态是单个 uint32，可存入 state 以保证纯函数式推进。
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameRng = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // 由任意整数种子派生出 n 个互不相关的流状态（splitmix 风格散列）
  function hash32(x) {
    x = (x + 0x9E3779B9) | 0;
    x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B);
    x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35);
    return (x ^ (x >>> 16)) >>> 0;
  }
  function deriveState(seed, salt) { return hash32((seed | 0) ^ hash32(salt | 0)); }

  /** 从状态值创建 PRNG；state() 取回当前状态 */
  function create(stateValue) {
    let a = stateValue >>> 0;
    function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next,
      state: () => a,
      uniform: (lo, hi) => lo + (hi - lo) * next(),
      int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // 含两端
      chance: (p) => next() < p,
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      normal() {                       // Box-Muller（不缓存，保证 state 完整）
        const u = 1 - next(), v = next();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      },
      exponential: (rate) => -Math.log(1 - next()) / rate
    };
  }

  return { create, deriveState, hash32 };
});
