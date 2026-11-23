/* ui/rules.js — 规则说明页（一页纸，不是分步教程）
   所有数值从 GameConfig / GameResearch 读取，改 config 后文案自动同步。
   第一次启动自动弹出；之后可从顶部"规则"按钮再次打开。 */
const GameRules = (() => {
  const SEEN_KEY = 'kline-game-v0-rules-seen';
  const C = () => GameConfig;
  const money = (n) => '¥' + n.toLocaleString('zh-CN');
  const num = (x) => String(+x.toFixed(2)); // 去掉多余的 0

  function lines() {
    const c = C(), f = c.fees, R = c.research;
    const sig = (p) => (GameResearch.sigmaFor(p) * 100).toFixed(0);
    return [
      ['🎯 评分', `游戏按<b>总分</b>评 S / A / B / C / D，<b>B 及以上过关</b>（等级线：S ${c.scoring.grades.S}、A ${c.scoring.grades.A}、B ${c.scoring.grades.B}、C ${c.scoring.grades.C}）。总分 = ${c.quarters} 个季度分 ＋ 终局分 － 回撤扣分。<b>季度分</b>：每 ${c.quarterLength} 回合一个季度，你的季度收益率高于"开局平均买入 4 家公司并一直持有"的基准就得 ${c.scoring.quarter.beatBase} 分，超额每 1 个百分点再 ${c.scoring.quarter.perPoint >= 0 ? '加' : '减'} ${Math.abs(c.scoring.quarter.perPoint)} 分（单季度 ${c.scoring.quarter.min} ~ ${c.scoring.quarter.max} 分）。<b>终局分</b>：全局超额收益每 1 个百分点 ${c.scoring.final.perPoint} 分（${c.scoring.final.min} ~ ${c.scoring.final.max}）。<b>回撤扣分</b>：最大回撤超过 ${(c.scoring.drawdown.threshold * 100).toFixed(0)}% 的部分，每个百分点扣 ${c.scoring.drawdown.perPoint} 分，不封顶。本金 ${money(c.initialCash)}，总资产跌破 ${money(c.bankruptcyLine)} 直接判负（评 D）。`],
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

  return { open, close, isOpen, seen, lines };
})();
