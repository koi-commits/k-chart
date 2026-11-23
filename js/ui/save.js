/* ui/save.js — localStorage 自动存档（单槽，覆盖写；不提供手动读档） */
const GameSave = (() => {
  const KEY = 'kline-game-v0-save';

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('存档失败', e); }
  }

  /** 读取存档；格式不对或版本不符返回 null */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s && s.version === 2 && s.companies && s.candles ? s : null;
    } catch (e) { return null; }
  }

  function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  return { save, load, clear };
})();
