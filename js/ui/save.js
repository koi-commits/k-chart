/* ui/save.js — localStorage 自动存档（单槽，覆盖写；不提供手动读档）
   存 { state, record, view }：
   · record 是试玩记录（见 game/record.js）；record.pending.orders 是本回合待执行的订单队列
   · view 是"还没看完的结算弹窗"（{weeklyTurn} 或 {quarter}），用于回放/弹窗途中退出后重进
   不做数据迁移：版本与当前不一致、或缺少关键字段的存档一律不进入游戏（见 check）。 */
const GameSave = (() => {
  const KEY = 'kline-game-v0-save';
  const VERSION = 2; // state.version（存档结构版本）

  function save(state, record, view) {
    try { localStorage.setItem(KEY, JSON.stringify({ state, record, view: view || null })); } catch (e) { console.warn('存档失败', e); }
  }

  const isNum = (x) => typeof x === 'number' && isFinite(x);
  const isObj = (x) => !!x && typeof x === 'object';

  /** 当前版本存档缺了哪个关键字段（没缺返回 null）。只检查，不修补。 */
  function missingField(d) {
    const s = d.state, r = d.record;
    if (!isObj(s)) return 'state';
    if (s.version !== VERSION) return 'state.version';
    for (const k of ['companies', 'candles', 'vPath', 'positions', 'research']) if (!isObj(s[k])) return 'state.' + k;
    if (!Array.isArray(s.equity) || !s.equity.length) return 'state.equity';
    if (s.status !== 'playing' && s.status !== 'ended') return 'state.status';
    if (!isObj(r)) return 'record';
    if (!Array.isArray(r.turns)) return 'record.turns';
    if (!isObj(r.pending) || !Array.isArray(r.pending.research)) return 'record.pending';
    if (r.pending.orders != null && !Array.isArray(r.pending.orders)) return 'record.pending.orders';
    if (r.seed !== s.seed) return 'record.seed';
    if (s.status === 'ended') {
      const res = s.result;
      if (!isObj(res)) return 'state.result';
      if (!isObj(res.score) || !Array.isArray(res.score.quarters) || !isObj(res.score.drawdown) || !isObj(res.score.final)) return 'state.result.score';
      if (!isNum(res.excessDrawdown)) return 'state.result.excessDrawdown';
      if (!isObj(r.result)) return 'record.result';
    }
    return null;
  }

  /**
   * 校验存档（纯函数）。raw = localStorage 里的原始字符串，current = 当前规则版本（config.rulesVersion）。
   * 兼容性按规则版本判断：规则版本相同、程序版本不同的存档可以继续玩。
   * versionsOf = GameRecord.versionsOf（记录 → {build, rules, label}）。
   * → null（没有存档）
   * → { ok: true, state, record, view }
   * → { ok: false, reason: 'version' | 'broken' | 'corrupt', version, record, data, raw, field }
   */
  function check(raw, current, versionsOf) {
    if (raw == null || raw === '') return null;
    let d;
    try { d = JSON.parse(raw); } catch (e) { return { ok: false, reason: 'corrupt', version: null, record: null, data: null, raw }; }
    if (!isObj(d)) return { ok: false, reason: 'corrupt', version: null, record: null, data: null, raw };
    const record = isObj(d.record) ? d.record : null;
    const v = record ? versionsOf(record) : { build: null, rules: null, label: '(未标注)' };
    const version = v.build ? v.label : null, rules = v.rules;
    if (rules !== current) return { ok: false, reason: 'version', version, rules, record, data: d, raw };
    const field = missingField(d);
    if (field) return { ok: false, reason: 'broken', version, rules, record, data: d, raw, field };
    return { ok: true, state: d.state, record: d.record, view: isObj(d.view) ? d.view : null };
  }

  /** 读取存档并校验（见 check） */
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return null; }
    return check(raw, GameConfig.rulesVersion, GameRecord.versionsOf);
  }

  /** 无法加载时给玩家看的说明 */
  function message(bad) {
    if (bad.reason === 'version') return `此存档来自旧版本 ${bad.version || '（未标注版本）'}${bad.rules ? `（规则版本 ${bad.rules}）` : ''}，无法在当前版本继续`;
    if (bad.reason === 'broken') return `此存档缺少关键数据（${bad.field}），无法在当前版本继续`;
    return '此存档已损坏，无法在当前版本继续';
  }

  /** "导出原记录"的内容：原样导出存档里的记录（不改版本号、不重新计分）；没有记录时导出整个存档原文 */
  function originalExport(bad) {
    if (bad.record) return { text: JSON.stringify(bad.record, null, 2), seed: bad.record.seed, version: bad.version };
    return { text: bad.raw, seed: null, version: bad.version };
  }

  function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  return { save, load, check, message, originalExport, clear, KEY, VERSION };
})();
if (typeof module === 'object' && module.exports) module.exports = GameSave;
