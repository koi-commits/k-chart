/* ============================================
   save-manager.js — 存档管理器
   多存档槽位 · localStorage持久化 · 元数据展示
   ============================================ */

const SaveManager = (() => {
  const SAVE_KEY = 'kline_saves';
  const MAX_SLOTS = 5;

  function getAllSaves() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
  }

  function saveSlot(slotIndex, name) {
    var saves = getAllSaves();
    var data = collectSaveData();
    data.name = name || ('存档 ' + (slotIndex + 1));
    data.slot = slotIndex;
    data.savedAt = Date.now();
    data.savedAtStr = new Date().toLocaleString('zh-CN');
    saves[slotIndex] = data;
    localStorage.setItem(SAVE_KEY, JSON.stringify(saves));
    return data;
  }

  function loadSlot(slotIndex) {
    var saves = getAllSaves();
    var data = saves[slotIndex];
    if (!data) return false;
    applySaveData(data);
    return true;
  }

  function deleteSlot(slotIndex) {
    var saves = getAllSaves();
    saves[slotIndex] = null;
    localStorage.setItem(SAVE_KEY, JSON.stringify(saves));
  }

  function collectSaveData() {
    var data = { account: null, trades: [], stats: {}, achievements: null, volatility: null };
    if (typeof Trader !== 'undefined') {
      var s = Trader.getSummary();
      data.account = { cash: s.cash, totalAssets: s.totalAssets, totalPnL: s.totalPnL, totalPnLPct: s.totalPnLPct, tradeCount: s.tradeCount };
      data.trades = (Trader.getTrades ? Trader.getTrades(50) : []);
    }
    if (typeof AchievementEngine !== 'undefined') {
      data.achievements = AchievementEngine.getUnlocked().length + '/' + AchievementEngine.getTotalCount();
      data.stats = AchievementEngine.getStats();
    }
    if (typeof VolatilityUpdater !== 'undefined') {
      data.volatility = VolatilityUpdater.getLastUpdateStr();
    }
    data.currentSymbol = (typeof App !== 'undefined' && App._curSym) ? App._curSym : '000001';
    return data;
  }

  function applySaveData(data) {
    if (!data || !data.account) return;
    if (typeof Trader !== 'undefined' && data.account) {
      Trader.setCapital(data.account.totalAssets);
      Trader._cash = data.account.cash;
    }
    try {
      localStorage.setItem('kline_account', JSON.stringify({
        cash: data.account.cash,
        initialCapital: data.account.totalAssets,
        positions: {},
        trades: data.trades || [],
        pendingOrders: [],
        savedAt: Date.now()
      }));
    } catch(e) {}
    // Reload trader
    if (typeof Trader !== 'undefined') Trader.load();
  }

  function formatSaveMeta(save) {
    if (!save) return null;
    return {
      name: save.name,
      assets: save.account ? '¥' + (save.account.totalAssets || 0).toLocaleString() : '¥0',
      pnl: save.account ? (save.account.totalPnL >= 0 ? '+' : '') + '¥' + (save.account.totalPnL || 0).toLocaleString() : '¥0',
      pnlColor: save.account && save.account.totalPnL >= 0 ? 'up' : 'down',
      trades: save.account ? save.account.tradeCount : 0,
      achievements: save.achievements || '0/35',
      date: save.savedAtStr || '未知',
      symbol: save.currentSymbol || '000001',
    };
  }

  return {
    getAllSaves, saveSlot, loadSlot, deleteSlot,
    formatSaveMeta, MAX_SLOTS, collectSaveData, applySaveData
  };
})();
