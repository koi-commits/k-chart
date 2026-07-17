/* alerts.js — Custom Alert System */
const AlertManager = (() => {
  var alerts = [];
  var nextId = 1;
  var listeners = [];
  var STORAGE_KEY = 'kline_alerts';

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        alerts = data.alerts || [];
        nextId = data.nextId || 1;
      }
    } catch(e) {}
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ alerts: alerts, nextId: nextId }));
    } catch(e) {}
  }

  function find(id) {
    for (var i = 0; i < alerts.length; i++) {
      if (alerts[i].id === id) return alerts[i];
    }
    return null;
  }

  function add(cond) {
    var alert = {
      id: nextId++,
      symbol: cond.symbol,
      name: cond.name || (Simulator.STOCKS[cond.symbol] && Simulator.STOCKS[cond.symbol].name) || cond.symbol,
      type: cond.type,
      value: cond.value || null,
      enabled: true,
      triggered: false,
      createdAt: Date.now(),
      triggeredAt: null,
      _prevK: undefined,
      _prevD: undefined
    };
    alerts.push(alert);
    save();
    fireListeners();
    return alert;
  }

  function remove(id) {
    alerts = alerts.filter(function(a) { return a.id !== id; });
    save();
    fireListeners();
  }

  function toggle(id) {
    var a = find(id);
    if (a) { a.enabled = !a.enabled; save(); fireListeners(); }
  }

  function rearm(id) {
    var a = find(id);
    if (a) { a.triggered = false; a.triggeredAt = null; a.enabled = true; save(); fireListeners(); }
  }

  function getAll() { return alerts.slice(); }

  function check(stockData) {
    var triggered = [];
    for (var i = 0; i < alerts.length; i++) {
      var alert = alerts[i];
      if (!alert.enabled || alert.triggered) continue;
      if (alert.symbol !== stockData.symbol) continue;

      var hit = false;
      var msg = '';

      switch (alert.type) {
        case 'price_above':
          if (stockData.price >= alert.value) {
            hit = true;
            msg = alert.name + ' 价格 ¥' + stockData.price.toFixed(2) + ' 上穿 ¥' + alert.value;
          }
          break;
        case 'price_below':
          if (stockData.price <= alert.value) {
            hit = true;
            msg = alert.name + ' 价格 ¥' + stockData.price.toFixed(2) + ' 下穿 ¥' + alert.value;
          }
          break;
        case 'rsi_above':
          if (typeof stockData.rsi === 'number' && stockData.rsi >= alert.value) {
            hit = true;
            msg = alert.name + ' RSI ' + stockData.rsi.toFixed(1) + ' 上穿 ' + alert.value;
          }
          break;
        case 'rsi_below':
          if (typeof stockData.rsi === 'number' && stockData.rsi <= alert.value) {
            hit = true;
            msg = alert.name + ' RSI ' + stockData.rsi.toFixed(1) + ' 下穿 ' + alert.value;
          }
          break;
        case 'kdj_cross':
          if (typeof stockData.kdjK === 'number' && typeof stockData.kdjD === 'number') {
            var kAbove = stockData.kdjK > stockData.kdjD;
            if (typeof alert._prevK === 'number' && typeof alert._prevD === 'number') {
              var prevKAbove = alert._prevK > alert._prevD;
              if (kAbove !== prevKAbove) {
                hit = true;
                msg = alert.name + ' KDJ ' + (kAbove ? '金叉(K上穿D)' : '死叉(K下穿D)');
              }
            }
            alert._prevK = stockData.kdjK;
            alert._prevD = stockData.kdjD;
          }
          break;
        case 'drawing_intersect':
          // Stub — future feature
          break;
      }

      if (hit) {
        alert.triggered = true;
        alert.triggeredAt = Date.now();
        alert.enabled = false;
        triggered.push({ alert: alert, message: msg });
      }
    }

    if (triggered.length > 0) {
      save();
      fireListeners();
    }

    return triggered;
  }

  function fireListeners() {
    listeners.forEach(function(fn) { try { fn(); } catch(e) {} });
  }

  function onUpdate(fn) { listeners.push(fn); }

  load();

  return {
    add: add,
    remove: remove,
    toggle: toggle,
    rearm: rearm,
    check: check,
    getAll: getAll,
    onUpdate: onUpdate,
    save: save
  };
})();
