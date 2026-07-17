/* app.js — 精简可工作版 */
const App = (() => {
  var curSym = '000001', sim = null, running = false, timer = null, speed = 5;
  var activeDrawTool = null, trendPts = [], drawings = [];
  var replayMode = false, replayBuf = [], replayIdx = 0, saveCnt = 0;
  var equityHist = [];
  var S = [2000,1500,1000,700,500,350,250,150,100,60];

  // Safe DOM helpers
  function $ (s){return document.querySelector(s);}
  function $$(s){return document.querySelectorAll(s);}
  function on(el,e,f){if(el)el.addEventListener(e,f);}
  function txt(s,v){var e=$(s);if(e)e.textContent=v;}
  function htm(s,v){var e=$(s);if(e)e.innerHTML=v;}
  function val(s,v){var e=$(s);if(e&&v!==undefined)e.value=v;return e?e.value:'';}

  // ── Init ──
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

    renderStockList();
    bindStockBtns();
    val('#tradePrice', sim.getPrice().toFixed(2));
    bindEvents();
    initSentiment();
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
        ChartManager.updateData(sim.getCandles());
        txt('#candleCount','K线: '+sim.getCandles().length);
      });
    });

    // draw tools: now handled via HTML inline onclick (App.activateDraw / App.clearDraws)

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
    if (chartEl) chartEl.addEventListener('click', handleDrawClick, true);

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
    var pages = {orderbook:'#pageOrderBook',trade:'#pageTrade',positions:'#pagePositions'};
    Object.keys(pages).forEach(function(k){var e=$(pages[k]);if(e)e.classList.toggle('active',k===tab);});
    if (tab==='positions') updatePositions();
    if (tab==='trade') { val('#tradePrice',sim.getPrice().toFixed(2)); updateEstimate(); }
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
      val('#tradeShares',''); val('#tradeSL',''); val('#tradeTP','');
      updateCapitalBar(); updateHistory(); updatePositions();
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
    saveCnt++; if(saveCnt>=30){Trader.save();saveCnt=0;}
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
  function updateAll(){updatePriceBar();updateOrderBook();updateCandleCount();updateStockListPrices();updateCapitalBar();updateEquityCurve();var tp=$('#tradePrice');if(tp&&!tp.value)tp.value=sim.getPrice().toFixed(2);}

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
    if(activeDrawTool===tool){activeDrawTool=null;trendPts=[];}
    else {activeDrawTool=tool;trendPts=[];}
    document.body.classList.toggle('drawing-crosshair',!!activeDrawTool);
    $$('.draw-btn').forEach(function(b){b.classList.toggle('active-tool',b.dataset.tool===activeDrawTool);});
    if (activeDrawTool) {
      showToast((activeDrawTool==='trend'?'📐 趋势线：点击K线图选两点':'➖ 水平线：点击K线图定位')+' · Esc取消');
    }
  }

  function handleDrawClick(e) {
    if (!activeDrawTool) return;
    var el = document.getElementById('mainChart');
    if (!el) return;
    var rect = el.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;

    if (activeDrawTool === 'horizontal') {
      var cs = ChartManager.getCandleSeries();
      if (!cs) return;
      var price = cs.coordinateToPrice(y);
      if (price == null) return;
      if (typeof price === 'object') price = price.price || price.value;
      if (typeof price !== 'number') return;
      addHLine(+price.toFixed(2));
      activateDrawTool(null);
    } else if (activeDrawTool === 'trend') {
      trendPts.push({ x: x, y: y });
      if (trendPts.length === 2) {
        addTLine(trendPts[0].x, trendPts[0].y, trendPts[1].x, trendPts[1].y);
        trendPts = [];
        activateDrawTool(null);
      } else {
        showToast('第1点已选 ✓ 请再次点击K线图选第2点');
      }
    }
  }
  function addHLine(price){
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
    switch(e.code){case'Space':e.preventDefault();togglePlay();break;case'ArrowRight':e.preventDefault();step();break;case'KeyR':e.preventDefault();reset();break;case'KeyT':e.preventDefault();activateDrawTool('trend');break;case'KeyH':e.preventDefault();activateDrawTool('horizontal');break;case'Escape':e.preventDefault();activateDrawTool(null);trendPts=[];break;}
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
    init();
  }
  return{
    start:start,play:play,pause:pause,step:step,reset:reset,quickSell:quickSell,
    activateDraw:activateDrawTool,
    clearDraws:clearDrawings,
  };
})();
document.addEventListener('DOMContentLoaded',function(){App.start();});
