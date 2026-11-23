/* ui/rules.js — 规则说明页（一页纸，不是分步教程）
   所有数值从 GameConfig / GameResearch 读取，改 config 后文案自动同步。
   第一次启动自动弹出；之后可从顶部"规则"按钮再次打开。 */
const GameRules = (() => {
  const SEEN_KEY = 'kline-game-v0-rules-seen';
  const C = () => GameConfig;
  const money = (n) => '¥' + n.toLocaleString('zh-CN');
  const num = (x) => String(+x.toFixed(2)); // 去掉多余的 0

  /** 评分：5 条以内，每条一句话；具体数值全部放进悬停说明（读 config） */
  function scoringItems() {
    const c = C(), S = c.scoring, T = (s) => GameTips.tip(s, 'r'), g = S.grades, pc = (x) => (x * 100).toFixed(0) + '%';
    const bench = '基准 = 开局第一天把本金平均买入全部 4 家公司并一直持有（不计手续费）。';
    return [
      `游戏按总分评 S / A / B / C / D，B 及以上过关。${T(`等级线：S ≥ ${g.S}、A ≥ ${g.A}、B ≥ ${g.B}、C ≥ ${g.C}，更低为 D。本金 ${money(c.initialCash)}，总资产跌破 ${money(c.bankruptcyLine)} 直接判负，一律评 D。`)}`,
      `总分 = 各季度分之和 ＋ 终局分 － 回撤扣分。${T(`共 ${c.quarters} 个季度；总分最低 ${S.totalMin}。`)}`,
      `季度分：每个季度的收益率跑赢基准就得基础分，超额越多分越高。${T(`每 ${c.quarterLength} 回合一个季度。${bench}超额 > 0 得 ${S.quarter.beatBase} 分基础分，超额每 1 个百分点再${S.quarter.perPoint >= 0 ? '加' : '减'} ${Math.abs(S.quarter.perPoint)} 分，单季度限制在 ${S.quarter.min} ~ ${S.quarter.max} 分。`)}`,
      `终局分：整局收益比基准高得越多，终局分越高。${T(`全局超额收益每 1 个百分点 ${S.final.perPoint} 分，限制在 ${S.final.min} ~ ${S.final.max} 分。${bench}`)}`,
      `回撤扣分：最大回撤 ＝ 你的总资产相对基准净值，从最高点回落的最大幅度，回落越多扣分越多。${T(`按每周收盘计算，不计盘中回落；只算跑输基准的部分——大盘下跌时你跌得比基准少，不扣分。超过 ${pc(S.drawdown.threshold)} 的部分每个百分点扣 ${S.drawdown.perPoint} 分，最多扣 ${S.drawdown.maxPenalty} 分。`)}`
    ];
  }
  const scoringHtml = () => `<div class="rules-score">${scoringItems().map((x, i) => `<div class="rs-item">${i + 1}. ${x}</div>`).join('')}</div>`;

  function lines() {
    const c = C(), f = c.fees, R = c.research;
    const sig = (p) => (GameResearch.sigmaFor(p) * 100).toFixed(0);
    return [
      ['🎯 评分', scoringHtml()],
      ['📅 时间', `每回合代表<b>一周</b>（${c.daysPerTurn} 个交易日）。点"结束回合"，本周的日 K 会逐根播放出来。`],
      ['🔬 研究', `每回合有 <b>${R.pointsPerTurn} 个研究点</b>。给一家公司投入研究点，会得到它"真实价值"的估计：真实价值<b>约 68% 的把握</b>落在估值给出的区间内，投入越多区间越窄（1 点区间半宽约 ${sig(1)}%，${R.pointsPerTurn} 点约 ${sig(R.pointsPerTurn)}%）。估值 <b>${R.validTurns} 回合</b>后过期。股价围着真实价值波动，偏离的部分是情绪，会逐渐回归。`],
      ['📰 新闻', `新闻讲的是<b>上周已经发生</b>的事，价格已经反映了。用它判断那次涨跌是基本面（真实价值变了）还是情绪（只是价格变了）。`],
      ['📝 成交', `订单在<b>下周一开盘价</b>成交，先卖后买，卖出所得可用于同回合买入；资金不够时买单按可买手数部分成交，剩余部分记为"资金不足未成交"。<b>T+1</b>：当天买入的股票当天不能卖——订单在下周一开盘成交，所以<b>本回合买入的股票，下回合才能卖出</b>。涨停（+${(c.limitPct * 100).toFixed(0)}%）买不进，跌停（−${(c.limitPct * 100).toFixed(0)}%）卖不出。`],
      ['💰 费用', `佣金万${num(f.commissionRate * 1e4)}（最低 ${money(f.minCommission)}），卖出另收印花税千${num(f.stampDutyRate * 1e3)}，过户费万${num(f.transferFeeRate * 1e4)}；大额订单还有市场冲击。`],
      ['🎲 每局不同', `4 家公司的增长、波动、负债每局随机，你看不到。结算后的"复盘"会揭晓真相。`]
    ];
  }

  function render(first) {
    const el = document.getElementById('rules');
    el.innerHTML = `<div class="card rules-card">
      <h2>规则说明</h2>
      <ol class="rules-list">${lines().map(([h, t]) => `<li><b class="rl-h">${h}</b><span>${t}</span></li>`).join('')}</ol>
      <div class="actions"><button class="primary" data-action="rules-close">${first ? '开始游戏' : '知道了'}</button></div>
    </div>`;
    el.hidden = false;
  }

  function seen() { try { return !!localStorage.getItem(SEEN_KEY); } catch (e) { return true; } } // 读不了存储就别反复弹
  function markSeen() { try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* ignore */ } }

  function open(first) { render(!!first); }
  function close() { document.getElementById('rules').hidden = true; markSeen(); }
  function isOpen() { return !document.getElementById('rules').hidden; }

  return { open, close, isOpen, seen, lines, scoringItems };
})();
