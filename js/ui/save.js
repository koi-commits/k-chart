/* ui/save.js — localStorage 自动存档（单槽，覆盖写；不提供手动读档）
   存 { state, record }：record 是试玩记录（见 game/record.js） */
const GameSave = (() => {
  const KEY = 'kline-game-v0-save';
  const VERSION = 2; // state.version；版本不符的旧存档直接丢弃

  function save(state, record) {
    try { localStorage.setItem(KEY, JSON.stringify({ state, record })); } catch (e) { console.warn('存档失败', e); }
  }

  /** 读取存档 → {state, record}；格式不对或版本不符返回 null */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      const s = d && d.state;
      return s && s.version === VERSION && s.companies && s.candles && s.vPath && d.record ? d : null;
    } catch (e) { return null; }
  }

  function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  return { save, load, clear };
})();
