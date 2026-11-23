/* ============================================
   scoring.js — 评分与评级（纯函数，只处理数字，不碰 state / DOM）
   总分 = 4 个季度分 + 终局分 − 回撤扣分；总分 → S/A/B/C/D；B 及以上过关。
   所有权重、上下限、阈值和等级线在 config.scoring。
   ============================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
  else root.GameScoring = factory(root.GameConfig);
})(typeof self !== 'undefined' ? self : this, function (GameConfig) {

  const SC = () => GameConfig.scoring;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const GRADES = ['S', 'A', 'B', 'C']; // 由高到低；低于 C 线为 D
  const PASS_GRADE = 'B';

  /** 季度分：excess = 本季度超额收益（百分点） */
  function quarterScore(excess) {
    const c = SC().quarter;
    const base = excess > 0 ? c.beatBase : 0;
    const bonus = c.perPoint * excess;
    const raw = base + bonus;
    const score = clamp(raw, c.min, c.max);
    return { excess, base, bonus, raw, score, clamped: score !== raw };
  }

  /** 终局分：excess = 全局超额收益（百分点） */
  function finalScore(excess) {
    const c = SC().final;
    const raw = c.perPoint * excess;
    const score = clamp(raw, c.min, c.max);
    return { excess, raw, score, clamped: score !== raw };
  }

  /**
   * 回撤扣分：maxDD 为"超额回撤"（小数，0.05 = 5%）——玩家总资产 ÷ 等权基准净值 的相对曲线，
   * 按每周收盘从历史最高点回落的最大幅度。超过阈值的部分每个百分点扣 perPoint 分，扣分封顶 maxPenalty。
   */
  function drawdownPenalty(maxDD) {
    const c = SC().drawdown;
    const over = Math.max(0, (maxDD - c.threshold) * 100);
    const raw = over * c.perPoint;
    const penalty = Math.min(raw, c.maxPenalty);
    return { maxDD, overPoints: over, raw, penalty, capped: penalty < raw };
  }

  function gradeOf(total) {
    const g = SC().grades;
    for (const k of GRADES) if (total >= g[k]) return k;
    return 'D';
  }
  const isPass = (grade) => grade === PASS_GRADE || grade === 'A' || grade === 'S';

  /** 距下一等级还差多少分：{grade, need} 或 null（已是 S） */
  function nextGrade(total) {
    const g = SC().grades, cur = gradeOf(total);
    const up = cur === 'D' ? 'C' : cur === 'C' ? 'B' : cur === 'B' ? 'A' : cur === 'A' ? 'S' : null;
    return up ? { grade: up, need: Math.max(0, g[up] - total) } : null;
  }

  /**
   * 汇总：quarterDiffs = 各季度（含进行中的）超额收益数组，finalExcess = 全局超额，maxDD = 最大回撤
   * @returns {quarters:[{...quarterScore}], quarterTotal, final, penalty, total, grade, pass}
   */
  function summarize(quarterDiffs, finalExcess, maxDD) {
    const quarters = quarterDiffs.map(quarterScore);
    const quarterTotal = quarters.reduce((a, q) => a + q.score, 0);
    const fin = finalScore(finalExcess), pen = drawdownPenalty(maxDD);
    const rawTotal = quarterTotal + fin.score - pen.penalty;
    const total = Math.max(SC().totalMin, rawTotal);                    // 总分下限
    const grade = gradeOf(total);
    return { quarters, quarterTotal, final: fin, drawdown: pen, rawTotal, total, totalFloored: total > rawTotal, grade, pass: isPass(grade) };
  }

  /**
   * 乐观上界："提前判死"指标用。已完成季度按实际得分，剩余季度每个都按单季度上限，终局分按上限，
   * 回撤扣分按当前最大回撤（只增不减，所以不可能少扣）。上界 < B 线 → 已不可能过关。
   * @param doneScores 已完成季度的得分数组
   */
  function bestPossible(doneScores, maxDD) {
    const c = SC();
    const remaining = GameConfig.quarters - doneScores.length;
    return doneScores.reduce((a, b) => a + b, 0) + remaining * c.quarter.max + c.final.max - drawdownPenalty(maxDD).penalty;
  }
  const isDead = (doneScores, maxDD) => bestPossible(doneScores, maxDD) < SC().grades[PASS_GRADE];

  return { quarterScore, finalScore, drawdownPenalty, gradeOf, isPass, nextGrade, summarize, bestPossible, isDead, GRADES, PASS_GRADE };
});
