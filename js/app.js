/* app.js — 精简可工作版 */
const App = (() => {
  var curSym = '000001', sim = null, running = false, timer = null, speed = 5;
  var activeDrawTool = null, trendPts = [], drawings = [];
  var replayMode = false, replayBuf = [], replayIdx = 0, saveCnt = 0;
  var equityHist = [];
  var S = [2000,1500,1000,700,500,350,250,150,100,60];

  // ── Overlay / Pattern state ──
  var overlayActive = false;
  var overlayStocks = [];      // selected symbols for comparison (max 5)
  var patternPanelOpen = true;

  // ── Watchlist state ──
  var wlTab = 'all', wlSort = 'default', wlCols = { showChange: true, showSector: true, showSparkline: false };
  var wlGroups = {
    lanchou: ['000001','600519','600900','000333','601318','600887'],
    keji: ['300750','688981','002230','000063','603259','600760','002594']
  };
  var zixuan = [];

  // ── Drawing state ──
  var drawState = { pts: [], rectEl: null, startX: 0, startY: 0 };

  // Safe DOM helpers
  function $ (s){return document.querySelector(s);}
  function $$(s){return document.querySelectorAll(s);}
  function on(el,e,f){if(el)el.addEventListener(e,f);}
  function txt(s,v){var e=$(s);if(e)e.textContent=v;}
  function htm(s,v){var e=$(s);if(e)e.innerHTML=v;}
  function val(s,v){var e=$(s);if(e&&v!==undefined)e.value=v;return e?e.value:'';}

  // ── 启动画面 ──
  var splashReady = false;
  function initSplash() {
    if (splashReady) return; // 防止递归
    renderSaveSlots();
    splashReady = true;
  }

  function bindSplashEvents() {
    on($('#btnNewGame'), 'click', function() { startNewGame(); });
    $$('.save-slot:not(.empty)').forEach(function(slot) {
      slot.addEventListener('click', function(e) {
        if (e.target.closest('.slot-delete')) return;
        loadGame(parseInt(slot.dataset.slot));
      });
    });
    $$('.slot-delete').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.slot);
        if (confirm('确定删除此存档？')) { SaveManager.deleteSlot(idx); splashReady = false; initSplash(); }
      });
    });
  }

  function renderSaveSlots() {
    var saves = (typeof SaveManager !== 'undefined') ? SaveManager.getAllSaves() : [];
    var container = $('#splashSlots'); if (!container) return;
    var html = '';
    for (var i = 0; i < 5; i++) {
      var save = saves[i];
      if (save) {
        var meta = SaveManager.formatSaveMeta(save);
        html += '<div class="save-slot" data-slot="' + i + '">' +
          '<div class="slot-num">' + (i + 1) + '</div>' +
          '<div class="slot-info"><div class="slot-name">' + (meta.name || '存档'+(i+1)) + '</div>' +
          '<div class="slot-meta"><span>📅 ' + meta.date + '</span><span>📊 ' + meta.trades + '笔</span><span>🏆 ' + meta.achievements + '</span></div></div>' +
          '<div class="slot-assets ' + (meta.pnlColor||'') + '">' + meta.assets + '</div>' +
          '<button class="slot-delete" data-slot="' + i + '">✕</button></div>';
      } else {
        html += '<div class="save-slot empty" data-slot="' + i + '">' +
          '<div class="slot-num">' + (i + 1) + '</div>' +
          '<div class="slot-info"><div class="slot-name" style="color:#666">空存档槽</div>' +
          '<div class="slot-meta"><span>点击新游戏创建</span></div></div></div>';
      }
    }
    container.innerHTML = html;
    bindSplashEvents();
    splashReady = true;
  }

  function startNewGame() {
    // 自动保存到第一个空槽
    var saves = SaveManager.getAllSaves();
    var emptySlot = -1;
    for (var i = 0; i < 5; i++) { if (!saves[i]) { emptySlot = i; break; } }
    if (emptySlot < 0) emptySlot = 0; // 覆盖第一个
    var name = prompt('给存档取个名字：', '我的交易之旅');
    SaveManager.saveSlot(emptySlot, name || '新存档');
    showLoadScreen(function() { hideSplash(); });
  }

  function loadGame(slotIndex) {
    showLoadScreen(function() {
      SaveManager.loadSlot(slotIndex);
      hideSplash();
    });
  }

  var loadTimer = null, loadVideoEl = null, loadAudioEl = null;
  function showLoadScreen(callback) {
    var splash = $('#splashScreen'); if (splash) splash.style.display = 'none';
    var load = $('#loadScreen'); if (!load) { if (callback) callback(); return; }
    load.style.display = 'flex';

    loadVideoEl = document.getElementById('loadVideo');
    loadAudioEl = document.getElementById('loadAudio');

    // 获取视频时长作为加载总时长
    var duration = 8; // 默认8秒
    if (loadVideoEl) {
      loadVideoEl.currentTime = 0;
      loadVideoEl.play().catch(function(){});
      // 尝试获取真实时长
      if (loadVideoEl.duration && isFinite(loadVideoEl.duration)) {
        duration = loadVideoEl.duration;
      } else {
        loadVideoEl.addEventListener('loadedmetadata', function() {
          if (isFinite(loadVideoEl.duration)) duration = loadVideoEl.duration;
        }, {once: true});
      }
    }
    if (loadAudioEl) { loadAudioEl.currentTime = 0; loadAudioEl.play().catch(function(){}); }

    var fill = $('#loadProgressFill');
    var text = $('#loadProgressText');
    var startTime = Date.now();
    var skipped = false;
    var msgs = ['正在读取存档...', '加载K线数据...', '初始化交易引擎...', '同步市场情绪...', '即将进入...'];

    // Skip button handler
    var skipHandler = function() {
      if (skipped) return;
      skipped = true;
      if (loadTimer) clearInterval(loadTimer);
      if (loadVideoEl) { loadVideoEl.pause(); loadVideoEl.style.display = 'none'; }
      if (loadAudioEl) { loadAudioEl.pause(); }
      // 切换到普通加载界面
      var vc = document.querySelector('.load-video-container');
      if (vc) vc.style.background = 'linear-gradient(180deg, #0a0a14 0%, #0d0d1a 100%)';
      var icon = document.querySelector('.load-icon-overlay'); if (icon) icon.style.display = 'none';
      // 加速进度条
      simpleLoadProgress(fill, text, msgs, callback, 250, startTime);
    };

    // 绑定跳过：点击视频区域或按任意键
    if (load) load.addEventListener('click', skipHandler, {once: true});
    document.addEventListener('keydown', skipHandler, {once: true});

    // 正常加载（根据视频时长）
    loadTimer = setInterval(function() {
      var elapsed = (Date.now() - startTime) / 1000;
      var pct = Math.min(100, (elapsed / duration) * 100);
      if (fill) fill.style.width = pct + '%';
      if (text) text.textContent = msgs[Math.min(Math.floor(pct / 25), msgs.length - 1)];
      if (elapsed >= duration) {
        clearInterval(loadTimer);
        if (fill) fill.style.width = '100%';
        if (text) text.textContent = '✓ 加载完成';
        if (loadVideoEl) loadVideoEl.pause();
        if (loadAudioEl) loadAudioEl.pause();
        setTimeout(function() {
          load.style.display = 'none';
          if (callback) callback();
        }, 400);
      }
    }, 250);
  }

  function simpleLoadProgress(fill, text, msgs, callback, interval, startTime) {
    var simDuration = 4; // 跳过时4秒快速加载
    loadTimer = setInterval(function() {
      var elapsed = (Date.now() - startTime) / 1000;
      var pct = Math.min(100, (elapsed / simDuration) * 100);
      if (fill) fill.style.width = pct + '%';
      if (text) text.textContent = msgs[Math.min(Math.floor(pct / 25), msgs.length - 1)];
      if (elapsed >= simDuration) {
        clearInterval(loadTimer);
        if (fill) fill.style.width = '100%';
        if (text) text.textContent = '✓ 加载完成';
        var load = $('#loadScreen'); if (load) load.style.display = 'none';
        if (callback) callback();
      }
    }, interval);
  }

  function hideSplash() {
    var splash = $('#splashScreen'); if (splash) { splash.style.transition = 'opacity 0.5s'; splash.style.opacity = '0'; setTimeout(function() { splash.style.display = 'none'; }, 500); }
    // Start main app after splash
    init();
  }

  function init() {
    sim = Simulator.get(curSym);
    for (var i=0;i<200;i++) sim.generateTick();

    ChartManager.init();
    ChartManager.updateData(sim.getCandles());

    if (Trader.load()) { updateCapitalBar(); updateHistory(); updatePositions(); }

    var st = localStorage.getItem('kline_theme');
    if (st && st !== document.documentElement.dataset.theme) {
      document.documentElement.dataset.theme = st;
      txt('#themeToggle', st==='light'?'☀️':'🌙');
    }
    var ss = localStorage.getItem('kline_speed');
    if (ss) { speed = parseInt(ss)||5; var sl=$('#speedSlider'); if(sl)sl.value=speed; txt('#speedValue','×'+speed); }

    // Load persisted watchlist + period state
    loadPersistedState();

    initWatchlistUI();
    renderStockList();
    bindStockBtns();
    val('#tradePrice', sim.getPrice().toFixed(2));
    bindEvents();
    initSentiment();
    initVolatility();
    initPatterns();
    // 成就系统
    if (typeof AchievementEngine !== 'undefined') {
      AchievementEngine.init();
      AchievementEngine.onUnlock(function(ach) {
        if (typeof AchievementToast !== 'undefined') AchievementToast.show(ach);
      });
    }
    updateAll();
    play();
  }

  // ── Events ──
  function bindEvents() {
    on($('#btnPlay'),'click',togglePlay);
    on($('#btnStep'),'click',step);
    on($('#btnReset'),'click',reset);
    on($('#btnReplay'),'click',toggleReplay);
    document.addEventListener('keydown',keyDown);

    on($('#speedSlider'),'input',function(){
      speed = parseInt(this.value)||5;
      txt('#speedValue','×'+speed);
      localStorage.setItem('kline_speed',speed);
      if(running){clearInterval(timer);startTimer();}
    });

    // period buttons
    $$('.period-selector button').forEach(function(b){
      on(b,'click',function(){
        $$('.period-selector button').forEach(function(x){x.classList.remove('active');});
        b.classList.add('active');
        sim.switchPeriod(b.dataset.period);
        if (typeof AchievementEngine !== 'undefined') AchievementEngine.recordTimeframe(b.dataset.period);
        ChartManager.updateData(sim.getCandles());
        txt('#candleCount','K线: '+sim.getCandles().length);
      });
    });

    // draw tools: now handled via HTML inline onclick (App.activateDraw / App.clearDraws)

    // watchlist tabs
    $$('.wl-tab').forEach(function(t){on(t,'click',function(){switchWatchlistTab(t.dataset.group);});});

    // column config
    on($('#btnColConfig'),'click',function(e){e.stopPropagation();toggleColConfig();});
    document.addEventListener('click',function(){var p=$('#colConfigPopover');if(p)p.style.display='none';});
    $$('#colConfigPopover input[type=checkbox]').forEach(function(cb){on(cb,'change',function(){updateColConfig(cb.dataset.col,cb.checked);});});

    // sort select
    on($('#wlSortSelect'),'change',function(){wlSort=this.value;try{localStorage.setItem('kline_watchlist_sort',wlSort);}catch(e){} renderStockList();});

    // stock list right-click context menu
    var stockListEl = document.getElementById('stockList');
    if (stockListEl) {
      stockListEl.addEventListener('contextmenu', function(e) {
        var item = e.target.closest('.stock-item');
        if (!item) return;
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, item.dataset.symbol);
      });
    }
    document.addEventListener('click', function(){ hideContextMenu(); });
    $$('.ctx-item').forEach(function(item){on(item,'click',function(){handleContextAction(item.dataset.action);});});

    // alert panel
    on($('#btnAlerts'),'click',function(){toggleAlertPanel();});
    on($('#btnAlertClose'),'click',function(){var p=$('#alertPanel');if(p)p.style.display='none';});
    on($('#alertPanel'),'click',function(e){if(e.target===this)this.style.display='none';});
    on($('#btnAddAlert'),'click',function(){
      var sym=$('#alertSymbol')?$('#alertSymbol').value:curSym;
      var type=$('#alertType')?$('#alertType').value:'price_above';
      var val=parseFloat($('#alertValue')?$('#alertValue').value:0)||0;
      if(typeof AlertManager!=='undefined'){
        AlertManager.add({symbol:sym,type:type,price:val,stockName:(Simulator.STOCKS[sym]||{}).name||sym});
        showToast('✓ 警报已设置');
      }
    });
    on($('#alertType'),'change',function(){var vf=$('#alertValueField');if(vf)vf.style.display=this.value==='kdj_cross'?'none':'';});

    // help overlay
    on($('#btnHelpClose'),'click',function(){var h=$('#helpOverlay');if(h)h.style.display='none';});
    on($('#helpOverlay'),'click',function(e){if(e.target===this)this.style.display='none';});

    // equity modal
    on($('#btnEquityClose'),'click',function(){var m=$('#equityModal');if(m)m.style.display='none';});
    on($('#equityModal'),'click',function(e){if(e.target===this)this.style.display='none';});

    // indicator switch
    on($('#indicatorSwitch'),'click',function(){
      var cur = ChartManager.getIndicatorMode();
      var nxt = cur==='rsi'?'kdj':'rsi';
      ChartManager.switchIndicator(nxt);
      txt('#indicatorSwitch',nxt==='rsi'?'RSI ▼':'KDJ ▼');
    });

    // Crosshair: update trade price + track position for drawing
    var mc = ChartManager.getMainChart();
    if (mc) {
      mc.subscribeCrosshairMove(function(p){
        if (p.point && p.time) {
          var pr = mc.priceScale('right').coordinateToPrice(p.point.y);
          if (pr != null) App._drawPos = {time:p.time, price:pr};
          var cs = ChartManager.getCandleSeries();
          if (p.seriesData && cs) {
            var cd = p.seriesData.get(cs);
            if (cd) val('#tradePrice', cd.close.toFixed(2));
          }
        }
      });
    }

    // Drawing: capture-phase click on chart container (fires before LC internal handlers)
    var chartEl = document.getElementById('mainChart');
    if (chartEl) {
      chartEl.addEventListener('click', handleDrawClick, true);
      // Rectangle: mousedown/mousemove/mouseup on chart
      chartEl.addEventListener('mousedown', function(e) {
        if (activeDrawTool !== 'rectangle') return;
        e.preventDefault();
        var rect = chartEl.getBoundingClientRect();
        drawState.startX = e.clientX - rect.left;
        drawState.startY = e.clientY - rect.top;
        drawState.rectEl = null;
      });
      chartEl.addEventListener('mousemove', function(e) {
        if (activeDrawTool !== 'rectangle' || drawState.startX === undefined) return;
        var rect = chartEl.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        var svg = document.getElementById('drawSvg');
        if (!svg) return;
        if (!drawState.rectEl) {
          drawState.rectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          drawState.rectEl.setAttribute('fill', isDark() ? 'rgba(66,165,245,0.15)' : 'rgba(25,118,210,0.12)');
          drawState.rectEl.setAttribute('stroke', isDark() ? '#42a5f5' : '#1976d2');
          drawState.rectEl.setAttribute('stroke-width', '1.5');
          drawState.rectEl.setAttribute('stroke-dasharray', '4,2');
          drawState.rectEl.classList.add('draw-rect');
          svg.appendChild(drawState.rectEl);
        }
        var rx = Math.min(drawState.startX, x);
        var ry = Math.min(drawState.startY, y);
        var rw = Math.abs(x - drawState.startX);
        var rh = Math.abs(y - drawState.startY);
        drawState.rectEl.setAttribute('x', rx);
        drawState.rectEl.setAttribute('y', ry);
        drawState.rectEl.setAttribute('width', rw);
        drawState.rectEl.setAttribute('height', rh);
      });
      chartEl.addEventListener('mouseup', function(e) {
        if (activeDrawTool !== 'rectangle' || !drawState.rectEl) return;
        var rect = chartEl.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        // Only keep if dragged enough distance
        if (Math.abs(x - drawState.startX) < 5 && Math.abs(y - drawState.startY) < 5) {
          try { drawState.rectEl.remove(); } catch(ex) {}
          drawState.rectEl = null;
          drawState.startX = undefined;
          return;
        }
        var cs = ChartManager.getCandleSeries();
        var p1 = cs ? cs.coordinateToPrice(drawState.startY) : null;
        var p2 = cs ? cs.coordinateToPrice(y) : null;
        if (typeof p1 === 'object') p1 = p1.price || p1.value;
        if (typeof p2 === 'object') p2 = p2.price || p2.value;
        var label = '';
        if (typeof p1 === 'number' && typeof p2 === 'number') {
          label = '¥' + Math.max(p1, p2).toFixed(2) + ' - ¥' + Math.min(p1, p2).toFixed(2);
        }
        var rectEl = drawState.rectEl;
        rectEl.setAttribute('data-label', label);
        drawings.push({type:'r',el:rectEl});
        drawState.rectEl = null;
        drawState.startX = undefined;
        showToast('✓ 矩形框已画');
        activateDrawTool(null);
      });
    }

    // theme
    on($('#themeToggle'),'click',function(){
      var h = document.documentElement, dk = h.dataset.theme==='dark';
      h.dataset.theme = dk?'light':'dark';
      txt('#themeToggle',dk?'☀️':'🌙');
      ChartManager.setTheme(dk);
      localStorage.setItem('kline_theme',dk?'light':'dark');
    });

    window.addEventListener('resize',function(){ChartManager.resize();});

    // trading panel tabs
    $$('.panel-tab').forEach(function(t){on(t,'click',function(){switchPanelTab(t.dataset.tab);});});

    // buy/sell side
    currentSide = 'buy'; // default
    $$('.trade-side').forEach(function(b){on(b,'click',function(){
      currentSide = b.dataset.side;
      $$('.trade-side').forEach(function(x){x.classList.toggle('active',x.dataset.side===currentSide);});
      updateTradeBtn();
      updateEstimate();
    });});

    on($('#tradePrice'),'input',updateEstimate);
    on($('#tradeShares'),'input',updateEstimate);

    // quick sizes
    $$('.size-btn').forEach(function(b){on(b,'click',function(){
      var r = parseFloat(b.dataset.ratio);
      if (currentSide==='sell') {
        var pos = Trader.getPositionInfo(curSym);
        if (pos) val('#tradeShares',Math.floor(pos.shares*r/100)*100);
      } else {
        val('#tradeShares',Trader.getBuyCapacity(curSym,r));
      }
      updateEstimate();
    });});

    on($('#btnSubmitTrade'),'click',submitTrade);

    Trader.onUpdate(function(evt){
      if (evt==='account') updateCapitalBar();
      if (evt==='trade') { updateCapitalBar(); updateHistory(); updatePositions(); Trader.save(); }
    });
  }

  // Fix the side toggle - currentSide should be set BEFORE calling updateEstimate
  function switchPanelTab(tab) {
    $$('.panel-tab').forEach(function(t){t.classList.toggle('active',t.dataset.tab===tab);});
    var pages = {orderbook:'#pageOrderBook',trade:'#pageTrade',positions:'#pagePositions',backtest:'#pageBacktest',analytics:'#pageAnalytics',achievements:'#pageAchievements',quant:'#pageQuant'};
    Object.keys(pages).forEach(function(k){var e=$(pages[k]);if(e)e.classList.toggle('active',k===tab);});
    if (tab==='positions') updatePositions();
    if (tab==='trade') { val('#tradePrice',sim.getPrice().toFixed(2)); updateEstimate(); }
    if (tab==='backtest') initBacktestPanel();
    if (tab==='analytics') { if (typeof Analytics !== 'undefined') Analytics.refresh(); }
    if (tab==='achievements') {
      var rp = document.getElementById('rightPanel'); if (rp) rp.classList.add('wide');
      if (typeof AchievementToast !== 'undefined') AchievementToast.renderGallery(document.getElementById('achGallery'));
      if (typeof AchievementEngine !== 'undefined') {
        var u = AchievementEngine.getUnlockCount(), t = AchievementEngine.getTotalCount();
        var cnt = document.getElementById('achCount'); if (cnt) cnt.textContent = u + '/' + t;
        var fill = document.getElementById('achProgressFill'); if (fill) fill.style.width = Math.round(u/t*100) + '%';
      }
    } else {
      var rp2 = document.getElementById('rightPanel'); if (rp2) rp2.classList.remove('wide');
    }
    if (tab==='quant') initQuantPanel();
  }

  function updateTradeBtn() {
    var b = $('#btnSubmitTrade'); if (!b) return;
    b.textContent = currentSide==='buy'?'买入':'卖出';
    b.className = 'trade-submit '+(currentSide==='buy'?'buy-btn':'sell-btn');
  }

  function updateEstimate() {
    var price = parseFloat($('#tradePrice')?$('#tradePrice').value:0) || sim.getPrice();
    var shares = parseInt($('#tradeShares')?$('#tradeShares').value:0) || 0;
    var fee = Trader.calcFee(currentSide,price,shares);
    var imp = Trader.calculateMarketImpact(curSym,currentSide,shares);
    txt('#estValue','¥'+(price*shares).toLocaleString());
    txt('#estFee','¥'+fee.total.toFixed(2));
    txt('#estImpact',(imp.impactPct>=0?'+':'')+imp.impactPct.toFixed(3)+'%');
  }

  function submitTrade() {
    var price = parseFloat(val('#tradePrice')) || sim.getPrice();
    var shares = parseInt(val('#tradeShares')) || 0;
    if (shares<100){showToast('最小交易单位100股','error');return;}
    var sl = parseFloat(val('#tradeSL'))||null;
    var tp = parseFloat(val('#tradeTP'))||null;
    var r = Trader.placeOrder(curSym,currentSide,shares,{slPrice:sl,tpPrice:tp});
    if (r.success) {
      showToast(r.message);
      // 成就记录
      if (typeof AchievementEngine !== 'undefined') {
        AchievementEngine.recordTrade(r);
        AchievementEngine.recordStockTraded(curSym);
        if (sl) AchievementEngine.recordSLTP('sl');
        if (tp) AchievementEngine.recordSLTP('tp');
        if (sl && tp) AchievementEngine.recordOCO();
        AchievementEngine.checkAll();
      }
      val('#tradeShares',''); val('#tradeSL',''); val('#tradeTP','');
      updateCapitalBar(); updateHistory(); updatePositions();
      initWatchlistUI();
    renderStockList(); // refresh stock list prices
    } else showToast(r.message,'error');
  }

  // ── Timer ──
  function startTimer() {
    stopTimer();
    timer = setInterval(tick, S[speed-1]||500);
  }
  function stopTimer() { if(timer){clearInterval(timer);timer=null;} }

  function tick() {
    sim.generateTick();
    var candles = sim.getCandles();
    if (candles.length>0) {
      var lc = candles[candles.length-1];
      var bl = replayBuf.length;
      if (bl===0||lc.time!==replayBuf[bl-1].time) replayBuf.push(JSON.parse(JSON.stringify(lc)));
      else replayBuf[bl-1]=JSON.parse(JSON.stringify(lc));
    }
    ChartManager.updateData(candles);
    updateAll();

    var trig = Trader.checkSLTP();
    trig.forEach(function(t){
      showToast(t.reason+(t.result.success?' 已平仓':''),t.result.success?'':'error');
      if(t.result.success){updateCapitalBar();updateHistory();updatePositions();Trader.save();}
    });

    // Check alerts
    if (typeof AlertManager !== 'undefined') {
      var lcCandle = sim.getLatestCandle();
      var alertData = { symbol: curSym, price: sim.getPrice(), time: lcCandle ? lcCandle.time : Date.now() };
      // Approximate RSI/KDJ from chart module
      try {
        var clArr = sim.getCandles().map(function(c){return c.close;});
        if (clArr.length > 14) {
          var rv = calcRSI(clArr, 14);
          alertData.rsi = rv[rv.length - 1];
        }
        if (clArr.length > 9) {
          var hiArr = sim.getCandles().map(function(c){return c.high;});
          var loArr = sim.getCandles().map(function(c){return c.low;});
          var kdjV = calcKDJ(hiArr, loArr, clArr, 9, 3, 3);
          if (kdjV && kdjV[kdjV.length-1]) {
            alertData.kdjK = kdjV[kdjV.length-1].k;
            alertData.kdjD = kdjV[kdjV.length-1].d;
          }
        }
      } catch(e) {}
      var triggeredAlerts = AlertManager.check(alertData);
      triggeredAlerts.forEach(function(ta){
        showToast('🔔 ' + ta.message, '');
        renderAlertList();
      });
    }

    // Check pending order book (limit/stop/bracket orders)
    var orderTrig = Trader.checkOrderBook();
    orderTrig.forEach(function(t){
      showToast(t.reason+(t.result && t.result.success?' 已成交':''));
      if(t.result && t.result.success){updateCapitalBar();updateHistory();updatePositions();Trader.save();}
    });

    // Pattern detection and rendering
    updatePatterns(candles);

    // Overlay comparison update
    if (overlayActive && overlayStocks.length > 0) updateOverlayComparison();

    saveCnt++; if(saveCnt>=30){Trader.save();saveCnt=0;}
    // 自动存档（每100 tick）
    if (saveCnt === 15 && typeof SaveManager !== 'undefined') {
      var saves = SaveManager.getAllSaves();
      var as = -1;
      for (var si = 0; si < 5; si++) { if (saves[si]) { as = si; break; } }
      if (as >= 0) SaveManager.saveSlot(as, saves[as] ? (saves[as].name || '自动存档') : '自动存档');
    }
    // 成就：蜡烛计数 + 每5tick检测
    if (typeof AchievementEngine !== 'undefined') {
      AchievementEngine.recordCandle();
      if (saveCnt % 5 === 0) AchievementEngine.checkAll();
    }

    // Periodic persistence (every ~10s at default speed)
    if (saveCnt % 50 === 0) savePersistedState();
  }

  // ── Controls ──
  function play(){running=true;txt('#btnPlay','⏸');var b=$('#btnPlay');if(b)b.classList.add('paused');startTimer();}
  function pause(){running=false;txt('#btnPlay','▶');var b=$('#btnPlay');if(b)b.classList.remove('paused');stopTimer();}
  function togglePlay(){running?pause():play();}
  function step(){if(running)pause();sim.generateTick();ChartManager.updateData(sim.getCandles());updateAll();}
  function reset(){
    pause();sim.reset();Trader.reset();equityHist=[];replayBuf=[];
    for(var i=0;i<200;i++)sim.generateTick();
    ChartManager.updateData(sim.getCandles());updateAll();updateHistory();updatePositions();
  }
  function switchStock(sym){
    if(sym===curSym)return;pause();curSym=sym;sim=Simulator.get(sym);
    if(sim.getCandles().length===0)for(var i=0;i<200;i++)sim.generateTick();
    ChartManager.updateData(sim.getCandles());
    val('#tradePrice',sim.getPrice().toFixed(2));
    updateAll();updateHistory();updatePositions();renderStockList();
    play();
  }

  // ── UI Updates ──
  function updateAll(){updatePriceBar();updateOrderBook();updateCandleCount();updateStockListPrices();updateCapitalBar();updateEquityCurve();updateStatusHint();var tp=$('#tradePrice');if(tp&&!tp.value)tp.value=sim.getPrice().toFixed(2);}

  function updatePriceBar() {
    var l = sim.getLatestCandle(); if(!l)return;
    var chg = sim.getChange(), d=chg.dir, s=chg.pct>=0?'+':'';
    var cfg = Simulator.STOCKS[curSym];
    txt('#stockTitle',cfg.name+' · '+curSym);
    txt('#currentPrice',l.close.toFixed(2));var cp=$('#currentPrice');if(cp)cp.className='current-price '+d;
    txt('#priceChange',s+chg.pct+'%');var pc=$('#priceChange');if(pc)pc.className='price-change '+d;
    txt('#infoOpen',l.open.toFixed(2));txt('#infoHigh',l.high.toFixed(2));txt('#infoLow',l.low.toFixed(2));txt('#infoClose',l.close.toFixed(2));txt('#infoVol',fmtVol(l.volume));
  }

  function updateOrderBook() {
    var p = sim.getPrice(), cfg=Simulator.STOCKS[curSym], h='';
    for(var i=5;i>=1;i--){var ap=p*(1+i*0.001+Math.random()*0.001),av=Math.floor(1000+Math.random()*5000)*100;h+='<div class="order-row ask"><span class="price">'+ap.toFixed(2)+'</span><span class="vol">'+Math.floor(av/100)+'</span><span class="depth-bar" style="width:'+((6-i)*15)+'%"></span></div>';}
    h+='<div style="text-align:center;padding:3px 4px;color:var(--text-muted);font-size:10px;border-top:1px solid var(--border-light);border-bottom:1px solid var(--border-light);">昨收 '+cfg.basePrice.toFixed(2)+' · 现价 '+p.toFixed(2)+'</div>';
    for(var i=1;i<=5;i++){var bp=p*(1-i*0.001-Math.random()*0.001),bv=Math.floor(1000+Math.random()*5000)*100;h+='<div class="order-row bid"><span class="price">'+bp.toFixed(2)+'</span><span class="vol">'+Math.floor(bv/100)+'</span><span class="depth-bar" style="width:'+(i*15)+'%"></span></div>';}
    htm('#orderBook',h);
  }

  function updateCapitalBar(){
    var s=Trader.getSummary(),sg=s.totalPnL>=0?'+':'';
    txt('#capTotal','¥'+s.totalAssets.toLocaleString());txt('#capCash','¥'+s.cash.toLocaleString());
    txt('#capPnL','¥'+sg+s.totalPnL.toLocaleString()+' ('+sg+s.totalPnLPct+'%)');
    var pe=$('#capPnL');if(pe)pe.className='capital-value '+(s.totalPnL>=0?'up':'down');
  }

  function updateHistory(){
    var t=Trader.getTrades(15);
    if(t.length===0){htm('#historyList','<div class="history-empty">暂无交易记录</div>');return;}
    htm('#historyList',t.map(function(x){
      var tag=x.side==='buy'?'<span class="side-tag buy">买</span>':'<span class="side-tag sell">卖</span>';
      var tm=new Date(x.time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      return '<div class="history-item">'+tag+'<span class="info">'+tm+' @'+x.price.toFixed(2)+'</span><span class="shares">'+((x.shares/100)|0)+'手</span></div>';
    }).join(''));
  }

  function updatePositions(){
    var p=Trader.getAllPositions();
    if(p.length===0){htm('#positionList','<div class="history-empty">暂无持仓</div>');return;}
    htm('#positionList',p.map(function(x){
      var s=x.pnl>=0?'+':'',d=x.pnl>=0?'up':'down';
      return '<div class="position-item" onclick="App.quickSell(\''+x.symbol+'\')"><div class="pos-name">'+x.name+' · '+x.symbol+'</div><div class="pos-shares">'+x.shares+'股 · 成本 ¥'+x.avgCost.toFixed(2)+'</div><div class="pos-pnl '+d+'">'+s+'¥'+x.pnl.toFixed(2)+' ('+s+x.pnlPct.toFixed(2)+'%)</div><div class="pos-cost">现价 ¥'+x.currentPrice.toFixed(2)+' · 市值 ¥'+x.marketValue.toFixed(2)+'</div></div>';
    }).join(''));
  }

  function quickSell(sym){
    switchPanelTab('trade');
    currentSide='sell';
    $$('.trade-side').forEach(function(b){b.classList.toggle('active',b.dataset.side==='sell');});
    updateTradeBtn();
    if(sym!==curSym){pause();curSym=sym;sim=Simulator.get(sym);ChartManager.updateData(sim.getCandles());updateAll();play();}
    var pos=Trader.getPositionInfo(sym);
    if(pos){val('#tradePrice',pos.currentPrice.toFixed(2));val('#tradeShares',pos.shares);updateEstimate();}
  }

  function updateStockListPrices(){
    $$('.stock-item').forEach(function(item){
      var sym=item.dataset.symbol,inst=Simulator.get(sym);if(!inst)return;
      var chg=inst.getChange(),ce=item.querySelector('.stock-change');
      if(ce){var s=chg.pct>=0?'+':'';ce.textContent=s+chg.pct+'%';ce.className='stock-change '+chg.dir;}
    });
  }
  function updateCandleCount(){txt('#candleCount','K线: '+sim.getCandles().length);}

  // Equity curve
  function updateEquityCurve(){
    var cv=$('#equityCanvas');if(!cv)return;var cx=cv.getContext('2d'),w=cv.width,h=cv.height,p=2;
    var a=Trader.getSummary().totalAssets;equityHist.push(a);if(equityHist.length>200)equityHist.shift();if(equityHist.length<2)return;
    cx.clearRect(0,0,w,h);var mn=Math.min.apply(null,equityHist),mx=Math.max.apply(null,equityHist),rg=mx-mn||1,up=a>=Trader.getSummary().initialCapital;
    cv.className='equity-sparkline '+(up?'up':'down');cx.beginPath();cx.strokeStyle=up?'#ff5252':'#66bb6a';cx.lineWidth=1.5;
    equityHist.forEach(function(v,i){var x=p+(i/(equityHist.length-1))*(w-p*2),y=p+(1-(v-mn)/rg)*(h-p*2);i===0?cx.moveTo(x,y):cx.lineTo(x,y);});cx.stroke();
  }

  // ── Toast ──
  var toastTmr=null;
  function showToast(msg,type){
    var t=$('#toast');if(!t)return;t.textContent=msg;t.className='toast '+(type||'')+' show';
    if(toastTmr)clearTimeout(toastTmr);toastTmr=setTimeout(function(){t.classList.remove('show');},2500);
  }

  // ── Drawings ──
  function activateDrawTool(tool){
    if(activeDrawTool===tool){activeDrawTool=null;drawState.pts=[];trendPts=[];}
    else {activeDrawTool=tool;drawState.pts=[];trendPts=[];}
    document.body.classList.toggle('drawing-crosshair',!!activeDrawTool);
    $$('.draw-btn').forEach(function(b){b.classList.toggle('active-tool',b.dataset.tool===activeDrawTool);});
    if (activeDrawTool) {
      var hints = {trend:'📐 趋势线：点击两点',horizontal:'➖ 水平线：点击定位',fibonacci:'📏 斐波那契：点击高点再点击低点',rectangle:'⬜ 矩形框：拖拽绘制',text:'🔤 文字标注：点击放置',measure:'📐 测量：点击起点再点击终点'};
      showToast((hints[activeDrawTool]||activeDrawTool)+' · Esc取消');
      updateStatusHint();
    } else { updateStatusHint(); }
  }

  function handleDrawClick(e) {
    if (!activeDrawTool) return;
    var el = document.getElementById('mainChart');
    if (!el) return;
    var rect = el.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;

    var cs = ChartManager.getCandleSeries();
    var price = null;
    if (cs) {
      var raw = cs.coordinateToPrice(y);
      if (raw != null) {
        if (typeof raw === 'object') price = raw.price || raw.value;
        else price = raw;
      }
    }

    switch (activeDrawTool) {
      case 'horizontal':
        if (price == null || typeof price !== 'number') return;
        addHLine(+price.toFixed(2));
        activateDrawTool(null);
        break;

      case 'trend':
        trendPts.push({ x: x, y: y });
        if (trendPts.length === 2) {
          addTLine(trendPts[0].x, trendPts[0].y, trendPts[1].x, trendPts[1].y);
          trendPts = [];
          activateDrawTool(null);
        } else {
          showToast('第1点已选 ✓ 请再次点击K线图选第2点');
        }
        break;

      case 'fibonacci':
        if (price == null || typeof price !== 'number') return;
        drawState.pts.push({ x: x, y: y, price: price });
        if (drawState.pts.length === 2) {
          addFibonacci(drawState.pts[0].price, drawState.pts[1].price);
          drawState.pts = [];
          activateDrawTool(null);
        } else {
          showToast('高点已选 ✓ 请点击低点');
        }
        break;

      case 'text':
        var txtIn = prompt('输入标注文字:');
        if (txtIn && txtIn.trim()) {
          addTextAnnotation(x, y, txtIn.trim());
        }
        activateDrawTool(null);
        break;

      case 'measure':
        drawState.pts.push({ x: x, y: y, price: price });
        if (drawState.pts.length === 2) {
          addMeasure(drawState.pts[0], drawState.pts[1]);
          drawState.pts = [];
          activateDrawTool(null);
        } else {
          showToast('起点已选 ✓ 请点击终点');
        }
        break;

      case 'rectangle':
        // Rectangle uses mousedown/mousemove/mouseup — handled separately
        break;
    }
  }
  function addHLine(price){
    if (typeof AchievementEngine !== 'undefined') AchievementEngine.recordDrawingTool('horizontal');
    var cs = ChartManager.getCandleSeries();
    if (!cs) return;
    try {
      var pl = cs.createPriceLine({
        price:price,
        color: isDark() ? '#42a5f5' : '#1976d2',
        lineWidth:2,
        lineStyle: 0, // 0=Solid (not 1=Dotted)
        axisLabelVisible:true,
        title:''+price.toFixed(2)
      });
      drawings.push({type:'h',pl:pl,series:cs});
      showToast('✓ 水平线 @ ¥'+price.toFixed(2));
    } catch(e) {
      showToast('HLine ERROR: '+e.message,'error');
    }
  }

  // Draw trend line using SVG overlay — extends infinitely in both directions
  function addTLine(x1,y1,x2,y2){
    if (typeof AchievementEngine !== 'undefined') AchievementEngine.recordDrawingTool('trend');
    var svg = document.getElementById('drawSvg');
    if (!svg) return;
    // Extend line to edges of the container
    var w = svg.clientWidth, h = svg.clientHeight;
    var dx = x2 - x1, dy = y2 - y1;
    var ex1, ey1, ex2, ey2;
    if (Math.abs(dx) < 0.001) {
      // Vertical line: extend to top and bottom
      ex1 = x1; ey1 = 0;
      ex2 = x1; ey2 = h;
    } else if (Math.abs(dy) < 0.001) {
      // Horizontal line: extend to left and right
      ex1 = 0; ey1 = y1;
      ex2 = w; ey2 = y1;
    } else {
      var m = dy / dx;
      // Intersection with left edge (x=0): y = y1 + m*(0 - x1)
      var yAt0 = y1 + m * (0 - x1);
      // Intersection with right edge (x=w): y = y1 + m*(w - x1)
      var yAtW = y1 + m * (w - x1);
      // Intersection with top edge (y=0): x = x1 + (0 - y1)/m
      var xAt0 = x1 + (0 - y1) / m;
      // Intersection with bottom edge (y=h): x = x1 + (h - y1)/m;
      var xAtH = x1 + (h - y1) / m;
      // Pick the two intersection points that fall within bounds
      var pts = [];
      if (yAt0 >= 0 && yAt0 <= h) pts.push({x:0, y:yAt0});
      if (yAtW >= 0 && yAtW <= h) pts.push({x:w, y:yAtW});
      if (xAt0 >= 0 && xAt0 <= w) pts.push({x:xAt0, y:0});
      if (xAtH >= 0 && xAtH <= w) pts.push({x:xAtH, y:h});
      if (pts.length >= 2) { ex1 = pts[0].x; ey1 = pts[0].y; ex2 = pts[1].x; ey2 = pts[1].y; }
      else { ex1 = x1; ey1 = y1; ex2 = x2; ey2 = y2; }
    }
    var line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',ex1); line.setAttribute('y1',ey1);
    line.setAttribute('x2',ex2); line.setAttribute('y2',ey2);
    line.setAttribute('stroke', isDark() ? '#ff9800' : '#e65100');
    line.setAttribute('stroke-width','2');
    line.setAttribute('stroke-linecap','round');
    svg.appendChild(line);
    drawings.push({type:'t',el:line});
    showToast('✓ 趋势线已画');
  }

  function clearDrawings(){
    drawings.forEach(function(d){
      if(d.type==='h'&&d.pl&&d.series) { try { d.series.removePriceLine(d.pl); } catch(e) {} }
      if(d.type==='t'&&d.el) { try { d.el.remove(); } catch(e) {} }
    });
    drawings=[];
    activateDrawTool(null);
    showToast('已清除所有画线');
  }

  // ── Stocks ──
  function renderStockList(){
    var syms=Object.keys(Simulator.STOCKS);
    htm('#stockList',syms.map(function(sym){
      var cfg=Simulator.STOCKS[sym],inst=Simulator.get(sym),chg=inst?inst.getChange():{pct:0,dir:'flat'};
      var s=chg.pct>=0?'+':'',ac=sym===curSym?' active':'';
      var sector=cfg.sector||'';
      return '<div class="stock-item'+ac+'" data-symbol="'+sym+'"><div class="stock-row1"><span class="stock-name">'+cfg.name+'</span><span class="stock-change '+chg.dir+'">'+s+chg.pct+'%</span></div><div class="stock-row2"><span class="stock-code">'+sym+'</span><span class="stock-sector">'+sector+'</span></div></div>';
    }).join(''));
    $$('#stockList .stock-item').forEach(function(item){item.addEventListener('click',function(){if(item.dataset.symbol!==curSym)switchStock(item.dataset.symbol);});});
  }
  function bindStockBtns(){
    on($('#btnAddStock'),'click',function(){openStockModal(null);});
    on($('#btnEditStock'),'click',function(){openStockModal(curSym);});
    on($('#btnModalCancel'),'click',function(){var m=$('#stockModal');if(m)m.style.display='none';});
    on($('#btnModalSave'),'click',saveStock);
    var m=$('#stockModal');if(m)m.addEventListener('click',function(e){if(e.target===m)m.style.display='none';});
  }
  function openStockModal(sym){
    var m=$('#stockModal');if(!m)return;
    if(sym){var cfg=Simulator.STOCKS[sym];if(!cfg)return;txt('#modalTitle','编辑股票');val('#editSymbol',sym);var se=$('#editSymbol');if(se)se.disabled=true;val('#editName',cfg.name);val('#editPrice',cfg.basePrice);val('#editSector',cfg.sector||'银行');val('#editVolatility',(cfg.annualVol||cfg.volatility||0.30).toFixed(3));val('#editTrend',(cfg.trend||0).toFixed(2));val('#editLimit',(cfg.limitPct||0.10).toFixed(2));}
    else{txt('#modalTitle','添加股票');var se=$('#editSymbol');if(se){se.value='';se.disabled=false;}val('#editName','');val('#editPrice','');val('#editSector','银行');val('#editVolatility','0.30');val('#editTrend','0.10');val('#editLimit','0.10');}
    m.style.display='flex';
  }
  function saveStock(){
    var sym=(val('#editSymbol')||'').trim(),name=(val('#editName')||'').trim()||sym;
    var bp=parseFloat(val('#editPrice'))||10,vol=parseFloat(val('#editVolatility'))||0.30,tr=parseFloat(val('#editTrend'))||0;
    var sector=val('#editSector')||'',limit=parseFloat(val('#editLimit'))||0.10;
    if(!sym){showToast('请输入股票代码','error');return;}
    Simulator.addStock(sym,{name:name,basePrice:bp,annualVol:vol,trend:tr,sector:sector,limitPct:limit});
    var m=$('#stockModal');if(m)m.style.display='none';
    initWatchlistUI();
    renderStockList();showToast(sym+' '+name+' 已添加');switchStock(sym);
  }

  // ── Replay ──
  function toggleReplay(){
    replayMode=!replayMode;var b=$('#btnReplay');
    if(replayMode){pause();replayBuf=sim.getCandles().map(function(c){return JSON.parse(JSON.stringify(c));});replayIdx=Math.max(0,replayBuf.length-60);if(b){b.classList.add('replay-active');b.textContent='⏮✓';}var ri=$('#replayInfo');if(ri)ri.style.display='inline';playReplay();}
    else{if(b){b.classList.remove('replay-active');b.textContent='⏮';}var ri=$('#replayInfo');if(ri)ri.style.display='none';stopTimer();play();}
  }
  function playReplay(){
    if(!replayMode)return;stopTimer();timer=setInterval(function(){
      if(replayIdx>=replayBuf.length-1){replayMode=false;var b=$('#btnReplay');if(b){b.classList.remove('replay-active');b.textContent='⏮';}var ri=$('#replayInfo');if(ri)ri.style.display='none';stopTimer();play();return;}
      replayIdx++;ChartManager.updateData(replayBuf.slice(0,replayIdx+1));
      var c=replayBuf[replayIdx];if(c){txt('#currentPrice',c.close.toFixed(2));txt('#infoOpen',c.open.toFixed(2));txt('#infoHigh',c.high.toFixed(2));txt('#infoLow',c.low.toFixed(2));txt('#infoClose',c.close.toFixed(2));txt('#infoVol',fmtVol(c.volume));}
      updateOrderBook();txt('#candleCount','K线: '+(replayIdx+1));
      txt('#replayInfo','回放 '+((replayIdx/(replayBuf.length-1))*100|0)+'% ['+replayIdx+'/'+replayBuf.length+']');
    },S[speed-1]||500);
  }

  // ── Helpers ──
  function keyDown(e){
    if(e.ctrlKey||e.metaKey||e.altKey||e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
    switch(e.code){case'Space':e.preventDefault();togglePlay();break;case'ArrowRight':e.preventDefault();step();break;case'KeyR':e.preventDefault();reset();break;case'KeyT':e.preventDefault();activateDrawTool('trend');break;case'KeyH':e.preventDefault();activateDrawTool('horizontal');break;case'KeyF':e.preventDefault();activateDrawTool('fibonacci');break;case'KeyB':e.preventDefault();activateDrawTool('rectangle');break;case'KeyX':e.preventDefault();activateDrawTool('text');break;case'KeyM':e.preventDefault();activateDrawTool('measure');break;case'F11':e.preventDefault();if(document.fullscreenElement){document.exitFullscreen();}else{document.documentElement.requestFullscreen();}break;case'Escape':e.preventDefault();activateDrawTool(null);trendPts=[];break;}
    var km={Digit1:'1m',Digit2:'5m',Digit3:'15m',Digit4:'1h',Digit5:'1d',Digit6:'1w'};
    if(km[e.code]){e.preventDefault();var p=km[e.code];$$('.period-selector button').forEach(function(b){b.classList.toggle('active',b.dataset.period===p);});sim.switchPeriod(p);ChartManager.updateData(sim.getCandles());txt('#candleCount','K线: '+sim.getCandles().length);}
  }
  function isDark(){return document.documentElement.dataset.theme!=='light';}
  function fmtVol(v){if(v>=1e8)return(v/1e8).toFixed(2)+'亿';if(v>=1e4)return(v/1e4).toFixed(1)+'万';return String(v);}

  // ── 市场情绪集成 ──
  function initSentiment() {
    var badge = document.getElementById('sentimentBadge');
    if (!badge) return;

    // 情绪数据回调：应用到所有股票
    MarketSentiment.onUpdate(function(data) {
      var mult = data.volatilityMultiplier;
      // 应用到所有活跃的模拟器实例
      var symbols = Object.keys(Simulator.STOCKS);
      symbols.forEach(function(sym) {
        try { Simulator.get(sym).setSentimentMultiplier(mult); } catch(e) {}
      });

      // 更新UI
      updateSentimentBadge(data);
    });

    // 更新徽章
    function updateSentimentBadge(data) {
      if (!badge) return;
      var s = data.score;
      var cls, label;
      if (!data.trading) {
        cls = 'offline'; label = '休市';
      } else if (s >= 75) {
        cls = 'hot'; label = '🔥 狂热 ' + s;
      } else if (s >= 58) {
        cls = 'warm'; label = '📈 偏热 ' + s;
      } else if (s >= 42) {
        cls = 'calm'; label = '⚖ 中性 ' + s;
      } else if (s >= 25) {
        cls = 'cold'; label = '📉 偏冷 ' + s;
      } else {
        cls = 'panic'; label = '❄ 恐慌 ' + s;
      }
      badge.textContent = label;
      badge.className = 'sentiment-badge ' + cls;
    }

    // 初始状态立即显示
    updateSentimentBadge({ score: 50, trading: false, cache: { upCount: 0, ztCount: 0 } });

    // 尝试连接真实市场数据
    if (typeof window.marketAPI !== 'undefined') {
      MarketSentiment.start(60); // 每60秒刷新

      // 网络不可用时的 fallback: 用本地多股票走势模拟情绪
      MarketSentiment.onUpdate(function(data) {
        if (!data.trading || (data.cache.upCount === 0 && data.cache.ztCount === 0)) {
          // 非交易时段或无网络数据，用本地股票走势计算
          var symbols = Object.keys(Simulator.STOCKS);
          var localMult = MarketSentiment.computeFromLocal(symbols);
          if (localMult !== data.volatilityMultiplier) {
            symbols.forEach(function(sym) {
              try { Simulator.get(sym).setSentimentMultiplier(localMult); } catch(e) {}
            });
          }
        }
      });
    } else {
      // preload 不可用（开发模式无 preload？），用本地数据
      badge.textContent = '⚖ 本地';
      badge.className = 'sentiment-badge calm';
      // 定期用本地多股票走势计算情绪
      setInterval(function() {
        var symbols = Object.keys(Simulator.STOCKS);
        var localMult = MarketSentiment.computeFromLocal(symbols);
        symbols.forEach(function(sym) {
          try { Simulator.get(sym).setSentimentMultiplier(localMult); } catch(e) {}
        });
      }, 30000);
    }
  }

  function start(){
    if(typeof LightweightCharts==='undefined'){setTimeout(start,100);return;}
    // 显示启动画面，用户选择存档后调用 hideSplash() → init()
    initSplash();
    // 如果有存档自动进入第一个
    var saves = SaveManager.getAllSaves();
    var hasSave = saves.some(function(s) { return !!s; });
    if (!hasSave) {
      // 无存档时仅显示启动画面
      return;
    }
  }

  // ── 波动率自动更新 ──
  function initVolatility() {
    var badge = document.getElementById('volatilityBadge');
    if (!badge) return;

    // 初始状态
    badge.textContent = '📡 检查中';
    badge.className = 'volatility-badge fetching';

    // 点击手动刷新
    badge.addEventListener('click', function() {
      if (badge.className.indexOf('fetching') >= 0) return; // 正在更新中
      badge.textContent = '📡 更新中';
      badge.className = 'volatility-badge fetching';
      VolatilityUpdater.forceRefresh(function(result) {
        updateVolatilityBadge(result);
        // 重建当前股票的模拟器实例以应用新波动率
        rebuildCurrentSim();
      });
    });

    // 异步初始化（先应用缓存，必要时联网更新）
    VolatilityUpdater.init(function(result) {
      updateVolatilityBadge(result);
      // 如果波动率有更新，重建模拟器
      if (result && result.success > 0) {
        rebuildCurrentSim();
      }
    });
  }

  function updateVolatilityBadge(result) {
    var badge = document.getElementById('volatilityBadge');
    if (!badge) return;

    var cacheAge = VolatilityUpdater.getCacheAge();
    var isExpired = VolatilityUpdater.isCacheExpired();

    if (result && result.success > 0) {
      // 网络更新成功 → 绿色"实时"
      badge.textContent = '📡 实时 ' + result.success + '/' + result.total;
      badge.className = 'volatility-badge live';
      badge.title = '波动率数据已更新\n' + result.updatedAt + '\n点击可手动刷新';
    } else if (!isExpired && cacheAge < Infinity) {
      // 缓存有效 → 橙色"缓存"
      var hours = Math.floor(cacheAge / 3600000);
      badge.textContent = '📡 缓存 ' + (hours > 0 ? hours + 'h前' : '刚才');
      badge.className = 'volatility-badge cached';
      badge.title = '使用缓存波动率数据 (' + VolatilityUpdater.getLastUpdateStr() + ')\n点击手动刷新';
    } else {
      // 无缓存 + 网络失败 → 红色"离线"
      badge.textContent = '📡 离线';
      badge.className = 'volatility-badge error';
      badge.title = '无法获取波动率数据，使用内置默认值\n点击重试';
    }
  }

  function rebuildCurrentSim() {
    // 波动率已自动从 STOCKS 读取，无需重建实例
    // 仅刷新股票列表显示
    initWatchlistUI();
    renderStockList();
  }

  // ── 策略回测面板 ──
  var btInitialized = false;
  function initBacktestPanel() {
    if (btInitialized) return;
    btInitialized = true;

    var btSym = $('#btSymbol');
    if (btSym) {
      var syms = Object.keys(Simulator.STOCKS);
      btSym.innerHTML = syms.map(function(sym) {
        var cfg = Simulator.STOCKS[sym];
        return '<option value="' + sym + '"' + (sym === curSym ? ' selected' : '') + '>' + cfg.name + ' (' + sym + ')</option>';
      }).join('');
    }

    var btPreset = $('#btPreset');
    if (btPreset && typeof BacktestEngine !== 'undefined') {
      var presets = BacktestEngine.PRESETS;
      btPreset.innerHTML = Object.keys(presets).map(function(key) {
        return '<option value="' + key + '">' + presets[key].name + '</option>';
      }).join('');
    }

    on($('#btnRunBacktest'), 'click', runBacktest);
  }

  function runBacktest() {
    if (typeof BacktestEngine === 'undefined') { showToast('回测引擎未加载', 'error'); return; }
    var sym = val('#btSymbol') || curSym;
    var presetKey = val('#btPreset') || 'rsi_oversold';
    var capital = parseFloat(val('#btCapital')) || 100000;
    var config = BacktestEngine.PRESETS[presetKey];
    if (!config) { showToast('请选择策略模板', 'error'); return; }

    config = Object.assign({}, config, { initialCapital: capital, warmupBars: 50 });
    showToast('正在回测 ' + config.name + '...');

    setTimeout(function() {
      var result = BacktestEngine.runAndSave(sym, config);
      if (result.error) { showToast(result.error, 'error'); return; }
      if (typeof AchievementEngine !== 'undefined') { AchievementEngine.recordBacktest(result); AchievementEngine.checkAll(); }
      displayBacktestResults(result);
      showToast('回测完成：' + result.stats.totalTrades + '笔交易');
    }, 100);
  }

  function displayBacktestResults(result) {
    var s = result.stats;
    var cards = [
      { v: '¥' + s.finalCapital.toLocaleString(), l: '最终资金', c: s.totalReturn >= 0 ? 'win' : 'lose' },
      { v: (s.totalReturn >= 0 ? '+' : '') + s.totalReturn + '%', l: '总收益率', c: s.totalReturn >= 0 ? 'win' : 'lose' },
      { v: s.sharpeRatio, l: '夏普比率', c: s.sharpeRatio >= 1 ? 'win' : s.sharpeRatio >= 0 ? 'neutral' : 'lose' },
      { v: s.maxDrawdown + '%', l: '最大回撤', c: 'lose' },
      { v: s.winRate + '%', l: '胜率', c: s.winRate >= 50 ? 'win' : 'lose' },
      { v: s.profitFactor, l: '盈亏比', c: s.profitFactor >= 1.5 ? 'win' : 'neutral' },
      { v: s.totalTrades, l: '总交易', c: 'neutral' },
      { v: '¥' + s.avgWin.toLocaleString(), l: '平均盈利', c: 'win' },
      { v: '¥' + s.avgLoss.toLocaleString(), l: '平均亏损', c: 'lose' },
      { v: '¥' + s.largestWin.toLocaleString(), l: '最大盈利', c: 'win' },
      { v: '¥' + s.largestLoss.toLocaleString(), l: '最大亏损', c: 'lose' },
      { v: s.avgHoldingBars + '根', l: '平均持仓', c: 'neutral' },
    ];
    htm('#btStatsGrid', cards.map(function(c) {
      return '<div class="bt-stat-card ' + c.c + '"><div class="bt-stat-val">' + c.v + '</div><div class="bt-stat-lbl">' + c.l + '</div></div>';
    }).join(''));

    var tradesHtml = result.trades.slice(-20).reverse().map(function(t) {
      return '<div class="bt-trade-item">' +
        '<span class="bt-trade-side entry">买</span>' +
        '<span class="bt-trade-info">@' + t.entryPrice.toFixed(2) + '→' + t.exitPrice.toFixed(2) + '</span>' +
        '<span class="bt-trade-side exit">' + t.exitReason + '</span>' +
        '<span class="bt-trade-pnl ' + (t.pnl >= 0 ? 'up' : 'down') + '">' + (t.pnl >= 0 ? '+' : '') + '¥' + t.pnl.toFixed(0) + '</span>' +
        '</div>';
    }).join('') || '<div class="history-empty">无交易记录</div>';
    htm('#btTradesList', tradesHtml);

    var re = $('#backtestResults'), ee = $('#backtestEmpty');
    if (re) re.style.display = '';
    if (ee) ee.style.display = 'none';
  }

  // ── 形态识别 ──
  function initPatterns() {
    var chartEl = document.getElementById('mainChart');
    if (chartEl && typeof PatternDetector !== 'undefined') {
      PatternDetector.initSvg(chartEl);
    }
    renderPatternList();
  }

  function updatePatterns(candles) {
    if (typeof PatternDetector === 'undefined') return;
    var patterns = PatternDetector.detect(candles);
    var chartEl = document.getElementById('mainChart');
    var mainChart = ChartManager.getMainChart();
    if (chartEl && mainChart && patterns.length > 0) {
      PatternDetector.renderMarkers(patterns, chartEl, mainChart);
    } else if (chartEl) {
      PatternDetector.clearMarkers(chartEl);
    }
  }

  function renderPatternList() {
    var container = document.getElementById('patternList');
    if (!container || typeof PatternDetector === 'undefined') return;
    var list = PatternDetector.getPatternList ? PatternDetector.getPatternList() : [];
    var html = '';
    list.forEach(function(m) {
      var id = m.id;
      var checked = PatternDetector.isPatternEnabled ? PatternDetector.isPatternEnabled(id) : true;
      var dotClass = m.type === 'bullish' || m.type === 'reversal-bull' ? 'bullish'
        : m.type === 'bearish' || m.type === 'reversal-bear' ? 'bearish' : 'neutral';
      html += '<div class="pattern-item" data-pattern="' + id + '" title="' + (m.name || id) + '">'
        + '<span class="pattern-type-dot ' + dotClass + '"></span>'
        + '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="App.togglePattern(\'' + id + '\', this.checked)">'
        + '<span>' + (m.name || id) + '</span>'
        + '</div>';
    });
    container.innerHTML = html;
  }

  function togglePatternPanel() {
    patternPanelOpen = !patternPanelOpen;
    var list = document.getElementById('patternList');
    var icon = document.getElementById('patternPanelIcon');
    if (list) list.style.display = patternPanelOpen ? '' : 'none';
    if (icon) icon.className = 'collapse-icon' + (patternPanelOpen ? '' : ' collapsed');
  }

  function togglePattern(key, checked) {
    if (typeof PatternDetector !== 'undefined' && PatternDetector.setPatternEnabled) {
      PatternDetector.setPatternEnabled(key, checked);
    }
  }

  // ── 多股对比覆盖 ──
  function toggleOverlay() {
    overlayActive = !overlayActive;
    var btn = document.getElementById('btnOverlayToggle');
    if (btn) btn.classList.toggle('active-tool', overlayActive);

    if (overlayActive) {
      overlayStocks = overlayStocks.length === 0 ? [curSym] : overlayStocks;
      ChartManager.showOverlay(overlayStocks);
      showToast('多股对比模式已开启，勾选左侧股票参与对比（最多5只）');
      initWatchlistUI();
    renderStockList();
      updateOverlayComparison();
    } else {
      overlayStocks = [];
      ChartManager.hideOverlay();
      initWatchlistUI();
    renderStockList();
    }
  }

  function toggleOverlayStock(sym) {
    var idx = overlayStocks.indexOf(sym);
    if (idx >= 0) {
      overlayStocks.splice(idx, 1);
    } else {
      if (overlayStocks.length >= 5) {
        showToast('最多只能选择5只股票进行对比', 'error');
        return;
      }
      overlayStocks.push(sym);
    }
    ChartManager.showOverlay(overlayStocks);
    updateOverlayComparison();
    initWatchlistUI();
    renderStockList();
  }

  function updateOverlayComparison() {
    if (overlayStocks.length === 0) return;

    var stockData = [];
    var colors = ['#ff5252', '#42a5f5', '#ff9800', '#ce93d8', '#66bb6a'];

    overlayStocks.forEach(function(sym, si) {
      var inst = Simulator.get(sym);
      if (!inst) return;
      var candles = inst.getCandles();
      if (!candles || candles.length < 2) return;
      var cfg = Simulator.STOCKS[sym];
      var baseClose = candles[0].close;
      if (baseClose <= 0) return;
      var prices = candles.map(function(c) {
        return { time: c.time, value: +((c.close / baseClose) * 100).toFixed(2) };
      });
      stockData.push({
        symbol: sym,
        name: (cfg ? cfg.name : sym) || sym,
        color: colors[si % colors.length],
        prices: prices
      });
    });

    if (typeof ChartManager !== 'undefined' && ChartManager.updateOverlay) {
      ChartManager.updateOverlay(stockData);
    }
  }

// ════════ MISSING INTEGRATION — injected before return ════════

  // ── Drawing: Update activateDrawTool to support new tools ──
  var _origActivateDraw = activateDrawTool;
  activateDrawTool = function(tool) {
    if (activeDrawTool === tool) { activeDrawTool = null; trendPts = []; drawState.pts = []; }
    else { activeDrawTool = tool; trendPts = []; drawState.pts = []; }
    document.body.classList.toggle('drawing-crosshair', !!activeDrawTool);
    $$('.draw-btn').forEach(function(b) { b.classList.toggle('active-tool', b.dataset.tool === activeDrawTool); });
    if (activeDrawTool) {
      var tips = { trend: '📐 趋势线：点击K线图选两点', horizontal: '➖ 水平线：点击K线图定位',
        fibonacci: '📏 斐波那契：先点高点再点低点', rectangle: '⬜ 矩形框：拖拽绘制',
        text: '🔤 文字标注：点击放置', measure: '📐 测量：点击两点' };
      showToast((tips[activeDrawTool] || activeDrawTool) + ' · Esc取消');
    }
  };

  // ── Drawing: Update handleDrawClick ──
  function getPriceFromY(y) {
    var cs = ChartManager.getCandleSeries();
    if (!cs) return null;
    var price = cs.coordinateToPrice(y);
    if (price == null) return null;
    if (typeof price === 'object') price = price.price || price.value;
    return typeof price === 'number' ? price : null;
  }

  var _origHandleDrawClick = handleDrawClick;
  handleDrawClick = function(e) {
    if (!activeDrawTool) return;
    var el = document.getElementById('mainChart');
    if (!el) return;
    var rect = el.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;

    if (activeDrawTool === 'horizontal') {
      var price = getPriceFromY(y);
      if (price == null) return;
      addHLine(+price.toFixed(2));
      activateDrawTool(null);
    } else if (activeDrawTool === 'trend') {
      trendPts.push({ x: x, y: y });
      if (trendPts.length === 2) {
        addTLine(trendPts[0].x, trendPts[0].y, trendPts[1].x, trendPts[1].y);
        trendPts = []; activateDrawTool(null);
      } else { showToast('第1点已选 ✓ 请再次点击K线图选第2点'); }
    } else if (activeDrawTool === 'fibonacci') {
      drawState.pts.push({ x: x, y: y, price: getPriceFromY(y) });
      if (drawState.pts.length === 2) {
        addFibonacci(drawState.pts[0], drawState.pts[1]);
        drawState.pts = []; activateDrawTool(null);
      } else { showToast('高点已选 ✓ 请点击低点'); }
    } else if (activeDrawTool === 'rectangle') {
      if (!drawState.rectEl) {
        drawState.startX = x; drawState.startY = y;
        var svg = document.getElementById('drawSvg');
        if (!svg) return;
        var rectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rectEl.setAttribute('x', x); rectEl.setAttribute('y', y);
        rectEl.setAttribute('width', '0'); rectEl.setAttribute('height', '0');
        rectEl.setAttribute('fill', isDark() ? 'rgba(66,165,245,0.15)' : 'rgba(25,118,210,0.1)');
        rectEl.setAttribute('stroke', isDark() ? '#42a5f5' : '#1976d2');
        rectEl.setAttribute('stroke-width', '1.5'); rectEl.setAttribute('stroke-dasharray', '4,2');
        svg.appendChild(rectEl); drawState.rectEl = rectEl;
        showToast('拖拽调整矩形，再次点击确认');
        var onMove = function(ev) {
          if (!drawState.rectEl) return;
          var r = el.getBoundingClientRect();
          var mx = ev.clientX - r.left, my = ev.clientY - r.top;
          var rx = Math.min(drawState.startX, mx), ry = Math.min(drawState.startY, my);
          drawState.rectEl.setAttribute('x', rx); drawState.rectEl.setAttribute('y', ry);
          drawState.rectEl.setAttribute('width', Math.abs(mx - drawState.startX));
          drawState.rectEl.setAttribute('height', Math.abs(my - drawState.startY));
        };
        el._rectMove = onMove; el.addEventListener('mousemove', onMove);
      } else {
        el.removeEventListener('mousemove', el._rectMove);
        var p1 = getPriceFromY(drawState.startY), p2 = getPriceFromY(y);
        var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', Math.min(drawState.startX, x) + 4);
        label.setAttribute('y', Math.min(drawState.startY, y) + 14);
        label.setAttribute('fill', isDark() ? '#42a5f5' : '#1976d2');
        label.setAttribute('font-size', '10'); label.setAttribute('font-family', 'monospace');
        label.textContent = (p1 && p2) ? '¥' + Math.min(p1, p2).toFixed(2) + ' ~ ¥' + Math.max(p1, p2).toFixed(2) : '';
        drawState.rectEl.parentNode.appendChild(label);
        drawings.push({ type: 'rect', el: drawState.rectEl, label: label });
        drawState.rectEl = null; activateDrawTool(null);
        showToast('✓ 矩形区域已标注');
      }
    } else if (activeDrawTool === 'text') {
      var txt = prompt('请输入标注文字：', '');
      if (txt) { addTextAnnotation(x, y, txt); showToast('✓ 文字标注已添加'); }
      activateDrawTool(null);
    } else if (activeDrawTool === 'measure') {
      drawState.pts.push({ x: x, y: y, price: getPriceFromY(y) });
      if (drawState.pts.length === 2) {
        addMeasure(drawState.pts[0], drawState.pts[1]);
        drawState.pts = []; activateDrawTool(null);
      } else { showToast('起点已选 ✓ 请点击终点'); }
    }
  };

  // ── New Drawing Functions ──
  function addFibonacci(p1, p2) {
    if (typeof AchievementEngine !== 'undefined') AchievementEngine.recordDrawingTool('fibonacci');
    var svg = document.getElementById('drawSvg');
    if (!svg) return;
    var levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
    var hi = p1.price > p2.price ? p1 : p2, lo = p1.price > p2.price ? p2 : p1;
    var cs = ChartManager.getCandleSeries();
    if (!cs) return;
    var vLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    vLine.setAttribute('x1', p1.x); vLine.setAttribute('y1', p1.y);
    vLine.setAttribute('x2', p2.x); vLine.setAttribute('y2', p2.y);
    vLine.setAttribute('stroke', 'rgba(255,152,0,0.5)'); vLine.setAttribute('stroke-width', '1');
    svg.appendChild(vLine); drawings.push({ type: 'fib', el: vLine });
    levels.forEach(function(r) {
      try {
        var price = hi.price - (hi.price - lo.price) * r;
        var pl = cs.createPriceLine({
          price: +price.toFixed(2), color: r === 0 || r === 1.0 ? '#ff9800' : 'rgba(255,152,0,0.4)',
          lineWidth: r === 0 || r === 1.0 ? 2 : 1, lineStyle: r === 0 || r === 1.0 ? 0 : 1,
          axisLabelVisible: true, title: (r * 100).toFixed(1) + '% ¥' + price.toFixed(2)
        });
        drawings.push({ type: 'fibLine', pl: pl, series: cs });
      } catch(e) {}
    });
    showToast('✓ 斐波那契回撤 (' + levels.length + '档)');
  }

  function addTextAnnotation(x, y, text) {
    if (typeof AchievementEngine !== 'undefined') AchievementEngine.recordDrawingTool('text');
    var svg = document.getElementById('drawSvg');
    if (!svg) return;
    var txtEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txtEl.setAttribute('x', x); txtEl.setAttribute('y', y);
    txtEl.setAttribute('fill', isDark() ? '#ffeb3b' : '#f57f17');
    txtEl.setAttribute('font-size', '13'); txtEl.setAttribute('font-weight', '600');
    txtEl.textContent = text;
    txtEl.addEventListener('dblclick', function(ev) {
      ev.stopPropagation();
      var newTxt = prompt('编辑标注：', txtEl.textContent);
      if (newTxt !== null) txtEl.textContent = newTxt || txtEl.textContent;
    });
    svg.appendChild(txtEl); drawings.push({ type: 'text', el: txtEl });
  }

  function addMeasure(p1, p2) {
    if (typeof AchievementEngine !== 'undefined') AchievementEngine.recordDrawingTool('measure');
    var svg = document.getElementById('drawSvg');
    if (!svg) return;
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
    line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
    line.setAttribute('stroke', isDark() ? '#ce93d8' : '#7b1fa2');
    line.setAttribute('stroke-width', '1.5'); line.setAttribute('stroke-dasharray', '6,3');
    svg.appendChild(line); drawings.push({ type: 'measure', el: line });
    var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    var diff = p1.price && p2.price ? Math.abs(p2.price - p1.price).toFixed(2) : '--';
    var pct = p1.price && p2.price ? (((p2.price - p1.price) / p1.price) * 100).toFixed(2) : '--';
    var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', mx + 4); label.setAttribute('y', my - 6);
    label.setAttribute('fill', isDark() ? '#ce93d8' : '#7b1fa2');
    label.setAttribute('font-size', '10'); label.textContent = 'Δ¥' + diff + ' (' + (pct >= 0 ? '+' : '') + pct + '%)';
    svg.appendChild(label); drawings.push({ type: 'measure', el: label });
    showToast('✓ 测量: Δ¥' + diff + ' (' + pct + '%)');
  }

  // ── Updated clearDrawings ──
  var _origClearDrawings = clearDrawings;
  clearDrawings = function() {
    drawings.forEach(function(d) {
      if ((d.type === 'h' || d.type === 'fibLine') && d.pl && d.series) { try { d.series.removePriceLine(d.pl); } catch(e) {} }
      if (d.el) { try { d.el.remove(); } catch(e) {} }
      if (d.label) { try { d.label.remove(); } catch(e) {} }
    });
    drawings = []; drawState.rectEl = null; drawState.pts = [];
    activateDrawTool(null);
    showToast('已清除所有画线');
  };

  // ── Missing App Methods ──
  function toggleAlertPanel() {
    var cfg = Simulator.STOCKS[curSym];
    var currentPrice = sim.getPrice();
    var priceStr = prompt('设置价格警报 — ' + cfg.name + ' (' + curSym + ')\n当前价格: ¥' + currentPrice.toFixed(2) + '\n\n请输入触发价格:');
    if (!priceStr) return;
    var triggerPrice = parseFloat(priceStr);
    if (isNaN(triggerPrice)) { showToast('价格无效', 'error'); return; }
    var direction = triggerPrice > currentPrice ? 'above' : 'below';
    if (typeof AlertManager !== 'undefined') {
      AlertManager.add({ symbol: curSym, type: 'price', direction: direction, price: triggerPrice, stockName: cfg.name });
    }
    showToast('✓ 警报已设置: ' + cfg.name + ' 价格' + (direction === 'above' ? '突破' : '跌破') + '¥' + triggerPrice.toFixed(2));
  }

  function showEquityModal() {
    var summary = Trader.getSummary();
    var trades = Trader.getTrades(999);
    var html = '<div style="padding:12px;max-height:70vh;overflow-y:auto">';
    html += '<h3 style="margin-bottom:8px">📊 权益分析</h3>';
    html += '<p>总资产: ¥' + summary.totalAssets.toLocaleString() + '</p>';
    html += '<p>总盈亏: ¥' + summary.totalPnL.toFixed(2) + ' (' + summary.totalPnLPct + '%)</p>';
    html += '<p>交易次数: ' + summary.tradeCount + ' | 持仓: ' + summary.positionCount + '</p>';
    if (trades.length > 0) {
      html += '<table style="width:100%;font-size:10px;margin-top:8px;border-collapse:collapse"><tr style="border-bottom:1px solid var(--border)"><th>时间</th><th>方向</th><th>价格</th><th>数量</th></tr>';
      trades.slice(0, 15).forEach(function(t) {
        html += '<tr><td>' + new Date(t.time).toLocaleTimeString() + '</td><td style="color:' + (t.side === 'buy' ? 'var(--up-color)' : 'var(--down-color)') + '">' + (t.side === 'buy' ? '买入' : '卖出') + '</td><td>¥' + t.price.toFixed(2) + '</td><td>' + t.shares + '股</td></tr>';
      });
      html += '</table>';
    }
    html += '</div>';
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:3000;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = '<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;max-width:440px;width:90%;color:var(--text-primary)">' + html + '<div style="padding:8px 12px;text-align:right"><button style="padding:4px 16px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text-primary);cursor:pointer" onclick="this.closest(\'div\').parentElement.parentElement.remove()">关闭</button></div></div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // ── Init: Watchlist tabs, sort, col config, patterns, restore state ──
  function initWatchlistUI() {
    // Tabs
    $$('.wl-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        wlTab = tab.dataset.group;
        $$('.wl-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.group === wlTab); });
        initWatchlistUI();
    renderStockList();
        try { localStorage.setItem('kline_watchlist_tab', wlTab); } catch(e) {}
      });
    });

    // Sort
    var ss = $('#wlSortSelect');
    if (ss) ss.addEventListener('change', function() { wlSort = ss.value; renderStockList();
      try { localStorage.setItem('kline_watchlist_sort', wlSort); } catch(e) {} });

    // Column config
    var ccb = $('#btnColConfig'), ccp = $('#colConfigPopover');
    if (ccb && ccp) {
      ccb.addEventListener('click', function(e) { e.stopPropagation(); ccp.style.display = ccp.style.display === 'none' ? 'block' : 'none'; });
      document.addEventListener('click', function() { ccp.style.display = 'none'; });
      ccp.querySelectorAll('input[type=checkbox]').forEach(function(cb) {
        cb.addEventListener('change', function() { wlCols[cb.dataset.col] = cb.checked; renderStockList();
          try { localStorage.setItem('kline_watchlist_cols', JSON.stringify(wlCols)); } catch(e) {} });
      });
    }

    // Context menu
    var ctxMenuEl = document.getElementById('ctxMenu');
    var ctxTarget = null;
    if (ctxMenuEl) {
      document.addEventListener('click', function() { ctxMenuEl.style.display = 'none'; });
      ctxMenuEl.querySelectorAll('.ctx-item').forEach(function(item) {
        item.addEventListener('click', function() {
          var action = item.dataset.action;
          if (action === 'switch' && ctxTarget) switchStock(ctxTarget);
          else if (action === 'addZixuan' && ctxTarget) { if (zixuan.indexOf(ctxTarget) < 0) { zixuan.push(ctxTarget); saveZixuan(); renderStockList(); } }
          else if (action === 'removeZixuan' && ctxTarget) { zixuan = zixuan.filter(function(s) { return s !== ctxTarget; }); saveZixuan(); renderStockList(); }
          else if (action === 'setAlert' && ctxTarget) toggleAlertPanel();
          ctxMenuEl.style.display = 'none';
        });
      });
      // Show on right-click
      var stockListEl = document.getElementById('stockList');
      if (stockListEl) {
        stockListEl.addEventListener('contextmenu', function(e) {
          var item = e.target.closest('.stock-item');
          if (!item) return;
          e.preventDefault(); ctxTarget = item.dataset.symbol;
          ctxMenuEl.style.display = 'block';
          ctxMenuEl.style.left = Math.min(e.clientX, window.innerWidth - 150) + 'px';
          ctxMenuEl.style.top = Math.min(e.clientY, window.innerHeight - 160) + 'px';
          var isZixuan = zixuan.indexOf(ctxTarget) >= 0;
          var addEl = ctxMenuEl.querySelector('[data-action="addZixuan"]');
          var remEl = ctxMenuEl.querySelector('[data-action="removeZixuan"]');
          if (addEl) addEl.style.display = isZixuan ? 'none' : '';
          if (remEl) remEl.style.display = isZixuan ? '' : 'none';
        });
      }
    }

    // Pattern checkboxes
    var patternList = document.getElementById('patternList');
    if (patternList && typeof PatternDetector !== 'undefined') {
      var patterns = PatternDetector.getPatternList();
      patternList.innerHTML = patterns.map(function(p) {
        return '<label class="config-opt" style="display:block;padding:1px 0;font-size:10px"><input type="checkbox" data-pattern="' + p.id + '" checked> ' + p.name + '</label>';
      }).join('');
      patternList.querySelectorAll('input').forEach(function(cb) {
        cb.addEventListener('change', function() { PatternDetector.setPatternEnabled(cb.dataset.pattern, cb.checked); });
      });
    }

    // Restore persisted state
    try {
      var tab = localStorage.getItem('kline_watchlist_tab');
      if (tab && ['all', 'lanchou', 'keji', 'zixuan'].indexOf(tab) >= 0) {
        wlTab = tab; $$('.wl-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.group === wlTab); });
      }
      var srt = localStorage.getItem('kline_watchlist_sort');
      if (srt) { wlSort = srt; var sEl = $('#wlSortSelect'); if (sEl) sEl.value = srt; }
      var cols = localStorage.getItem('kline_watchlist_cols');
      if (cols) { try { wlCols = JSON.parse(cols); } catch(e) {} }
      var zx = localStorage.getItem('kline_zixuan');
      if (zx) { try { zixuan = JSON.parse(zx); } catch(e) {} }
      // Alert & order module persistence
      if (typeof AlertManager !== 'undefined') AlertManager.load();
      if (typeof OrderTypes !== 'undefined') OrderTypes.load();
    } catch(e) {}
  }
  function saveZixuan() { try { localStorage.setItem('kline_zixuan', JSON.stringify(zixuan)); } catch(e) {} }

  // ── Tick Loop: Integrate orders + alerts + patterns ──
  var _origTick = tick;
  tick = function() {
    _origTick();
    if (typeof OrderTypes !== 'undefined') {
      var triggered = OrderTypes.check(sim.getPrice());
      triggered.forEach(function(t) { showToast(t.type + '订单触发: @¥' + t.price.toFixed(2)); updateCapitalBar(); updateHistory(); updatePositions(); });
    }
    if (typeof AlertManager !== 'undefined' && saveCnt % 5 === 0) {
      var cfg = Simulator.STOCKS[curSym];
      var hitAlerts = AlertManager.check({ symbol: curSym, price: sim.getPrice(), name: cfg ? cfg.name : curSym });
      hitAlerts.forEach(function(a) { showToast('🔔 ' + a.stockName + ' ' + a.description); });
    }
    if (typeof PatternDetector !== 'undefined' && saveCnt % 15 === 0) {
      var candles = sim.getCandles();
      if (candles.length > 3) {
        PatternDetector.clearMarkers();
        try {
          PatternDetector.renderMarkers(PatternDetector.detect(candles), document.getElementById('mainChart'), function(price) {
            var cs = ChartManager.getCandleSeries(); return cs ? cs.priceToCoordinate(price) : null;
          });
        } catch(e) {}
      }
    }
  };
  // ── Stub functions (referenced by UI but defined inline or simple) ──
  function renderAlertList() {
    // Alert list rendering handled by alerts.js panel
  }
  function savePersistedState() {
    try { localStorage.setItem('kline_watchlist_sort', wlSort); } catch(e) {}
  }
  function loadPersistedState() {
    try {
      var tab = localStorage.getItem('kline_watchlist_tab');
      if (tab) { wlTab = tab; $$('.wl-tab').forEach(function(t){t.classList.toggle('active',t.dataset.group===wlTab);}); }
      var srt = localStorage.getItem('kline_watchlist_sort'); if (srt) { wlSort = srt; var sEl=$('#wlSortSelect'); if(sEl)sEl.value=srt; }
      var cols = localStorage.getItem('kline_watchlist_cols'); if (cols) { try { wlCols = JSON.parse(cols); } catch(e) {} }
      var zx = localStorage.getItem('kline_zixuan'); if (zx) { try { zixuan = JSON.parse(zx); } catch(e) {} }
      try { if (typeof AlertManager !== 'undefined') AlertManager.load(); } catch(e) {}
      try { if (typeof OrderTypes !== 'undefined') OrderTypes.load(); } catch(e) {}
    } catch(e) {}
  }

  // ── 量化投资面板 ──
  var quantInitialized = false;
  function initQuantPanel() {
    if (quantInitialized) return;
    quantInitialized = true;
    on($('#btnQuantStart'), 'click', function() {
      if (typeof QuantTrading !== 'undefined') { QuantTrading.start(); updateQuantStatus(); showToast('自动交易已启动'); }
    });
    on($('#btnQuantStop'), 'click', function() {
      if (typeof QuantTrading !== 'undefined') { QuantTrading.stop(); updateQuantStatus(); showToast('自动交易已停止'); }
    });
    on($('#btnOptimize'), 'click', function() {
      if (typeof PortfolioOptimizer === 'undefined') { showToast('优化器未加载', 'error'); return; }
      showToast('正在计算最优配置...');
      setTimeout(function() {
        var result = PortfolioOptimizer.optimize();
        if (result.error) { showToast(result.error, 'error'); return; }
        displayAllocation(result, 'maxSharpe');
        displayRiskMetrics();
        showToast('优化完成');
      }, 150);
    });
    // Strategy checkbox wiring
    $$('#quantStrategies input[type=checkbox]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        if (typeof QuantTrading !== 'undefined') QuantTrading.setStrategyEnabled(cb.dataset.strat, cb.checked);
      });
    });
    // Optimization method tab switching
    $$('#quantOptTabs .quant-opt-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        $$('#quantOptTabs .quant-opt-tab').forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        try {
          var result = PortfolioOptimizer.optimize();
          if (!result.error) displayAllocation(result, tab.dataset.method);
        } catch(e) {}
      });
    });
    updateQuantStatus();
    // Auto-compute risk on tab open
    setTimeout(function() { displayRiskMetrics(); }, 200);
  }

  function updateQuantStatus() {
    var el = $('#quantStatus'); if (!el) return;
    if (typeof QuantTrading !== 'undefined' && QuantTrading.isRunning && QuantTrading.isRunning()) {
      el.textContent = '🟢 运行中'; el.className = 'quant-status running';
    } else { el.textContent = '⏸ 已停止'; el.className = 'quant-status stopped'; }
  }

  function displayAllocation(result, method) {
    var alloc = result.allocations[method] || result.allocations.maxSharpe;
    var c = $('#quantAllocation'); if (!c) return;
    var s = result.stats[method];
    var sh = s ? '<div style="display:flex;gap:12px;padding:4px 0;font-size:10px;color:var(--text-muted);margin-bottom:4px"><span>收益: ' + (s.expectedReturn*100).toFixed(1) + '%</span><span>波动: ' + (s.volatility*100).toFixed(1) + '%</span><span>夏普: ' + s.sharpeRatio.toFixed(2) + '</span></div>' : '';
    c.innerHTML = sh + alloc.map(function(a) { return '<div class="qa-item"><span style="flex:1">' + a.name + '</span><span style="font-size:10px;color:var(--text-muted);margin-right:6px">' + a.weight + '%</span><div class="qa-weight-bar"><div class="qa-weight-fill" style="width:' + a.weight + '%"></div></div></div>'; }).join('');
  }

  function displayRiskMetrics() {
    var c = $('#riskMetricsBody'); if (!c) return;
    if (typeof RiskMetrics === 'undefined') { c.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:12px">风险模块未加载</div>'; return; }
    var candles = sim.getCandles();
    if (candles.length < 20) { c.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:12px">数据不足(需20根K线)</div>'; return; }
    try {
      var m = RiskMetrics.computeAll(curSym, candles);
      if (!m) { c.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:12px">计算失败</div>'; return; }
      var score = Math.min(100, Math.max(0, Math.round((m.annualVol || 0.3) * 100)));
      var sc = score < 25 ? 'safe' : score < 50 ? 'warn' : 'danger';
      c.innerHTML = '<div class="risk-score-gauge" style="--gauge-pos:' + score + '%"></div><div style="text-align:center;font-size:11px;margin-bottom:6px">风险评分: <b class="' + sc + '" style="font-size:14px">' + score + '</b>/100</div><div class="risk-grid">' +
        '<div class="risk-card ' + ((m.annualVol||0) > 0.4 ? 'danger' : (m.annualVol||0) > 0.25 ? 'warn' : 'safe') + '"><div class="risk-val">' + ((m.annualVol||0)*100).toFixed(1) + '%</div><div class="risk-lbl">年化波动率</div></div>' +
        '<div class="risk-card ' + ((m.sharpeRatio||0) > 1 ? 'safe' : 'warn') + '"><div class="risk-val">' + (m.sharpeRatio||0).toFixed(2) + '</div><div class="risk-lbl">夏普比率</div></div>' +
        '<div class="risk-card danger"><div class="risk-val">' + ((m.var95||0)*100).toFixed(2) + '%</div><div class="risk-lbl">95% VaR</div></div>' +
        '<div class="risk-card ' + ((m.maxDrawdown||0) < 0.1 ? 'safe' : 'danger') + '"><div class="risk-val">' + ((m.maxDrawdown||0)*100).toFixed(1) + '%</div><div class="risk-lbl">最大回撤</div></div>' +
        '<div class="risk-card"><div class="risk-val">' + (m.sortinoRatio||0).toFixed(2) + '</div><div class="risk-lbl">索提诺比率</div></div>' +
        '<div class="risk-card"><div class="risk-val">' + (m.beta||0).toFixed(2) + '</div><div class="risk-lbl">Beta系数</div></div></div>';
      var te = $('#riskUpdateTime'); if (te) te.textContent = new Date().toLocaleTimeString();
    } catch(e) { c.innerHTML = '<div style="color:var(--up-color);font-size:11px">计算错误</div>'; }
  }

  // ── Quant tick hook ──
  var _qtTick = tick;
  tick = function() {
    _qtTick();
    if (typeof QuantTrading !== 'undefined' && QuantTrading.isRunning && QuantTrading.isRunning()) {
      try {
        QuantTrading.tick({ symbol: curSym, candles: sim.getCandles(), price: sim.getPrice() });
        var dc = $('#quantDailyCount'); if (dc && QuantTrading.getTradeLog) dc.textContent = QuantTrading.getTradeLog().length;
        var log = QuantTrading.getTradeLog ? QuantTrading.getTradeLog() : [];
        if (log.length > 0) {
          var le = $('#quantTradeLog');
          if (le) le.innerHTML = log.slice(-10).reverse().map(function(t) { return '<div class="qt-entry ' + t.side + '">' + (t.side==='buy'?'📈买':'📉卖') + ' ' + t.symbol + ' @' + t.price.toFixed(2) + ' ×' + t.shares + ' <span style="font-size:9px">' + (t.strategy||'') + '</span></div>'; }).join('') || '<div style="color:var(--text-muted)">等待信号...</div>';
        }
      } catch(e) {}
    }
  };
  return{
    start:start,play:play,pause:pause,step:step,reset:reset,quickSell:quickSell,
    activateDraw:activateDrawTool,
    clearDraws:clearDrawings,
    toggleAlertPanel:toggleAlertPanel,
    toggleOverlay:toggleOverlay,
    togglePatternPanel:togglePatternPanel,
    toggleOverlayStock:toggleOverlayStock,
    showEquityModal:showEquityModal,
    quickSave:function(){
      var saves = SaveManager.getAllSaves();
      var slot = -1;
      for (var i = 0; i < 5; i++) { if (saves[i]) { slot = i; break; } }
      if (slot < 0) slot = 0;
      SaveManager.saveSlot(slot, saves[slot] ? (saves[slot].name || '存档') : '自动存档');
      showToast('💾 游戏已保存到槽位 ' + (slot+1));
    },
    startTutorial:function(){
      if(typeof TutorialUI!=='undefined'&&typeof TutorialContent!=='undefined'){
        TutorialUI.init(TutorialContent);
      }
    },
  };
})();
document.addEventListener('DOMContentLoaded',function(){App.start();});
