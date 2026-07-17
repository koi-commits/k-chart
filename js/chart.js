/* chart.js — 最小版，只画K线+VOL+MACD */
const ChartManager = (() => {
  let mainChart, candleSeries, ma5, ma10, ma20;
  let volChart, volSeries;
  let macdChart, macdHist, macdSig, macdLine;
  let bollU, bollM, bollL;
  let rsiChart, rsiSeries, rsiOver, rsiUnder;
  let kdjK, kdjD, kdjJ;
  let indiMode = 'rsi';
  let dark = true;
  var overlaySymbols = [];
  var overlayCanvas = null;

  const C = {
    dark: { bg:'#0d0d0d', txt:'#999', grid:'#1a1a1a', bd:'#2a2a2a', up:'#ff5252', dn:'#66bb6a', upBg:'rgba(255,82,82,0.2)', dnBg:'rgba(102,187,106,0.2)', ma5:'#f5a623', ma10:'#42a5f5', ma20:'#ce93d8', boll:'rgba(255,183,77,0.5)', macdL:'#42a5f5', macdS:'#f5a623', macdU:'rgba(255,82,82,0.5)', macdD:'rgba(102,187,106,0.5)', rsi:'#7c4dff', rsio:'rgba(255,82,82,0.3)', rsiu:'rgba(102,187,106,0.3)', k:'#f5a623', d:'#42a5f5', j:'#ce93d8', x:'#555' },
    light:{ bg:'#fff', txt:'#666', grid:'#f0f0f0', bd:'#e0e0e0', up:'#e53935', dn:'#2e7d32', upBg:'rgba(229,57,53,0.2)', dnBg:'rgba(46,125,50,0.2)', ma5:'#e67e22', ma10:'#1976d2', ma20:'#9b59b6', boll:'rgba(230,126,34,0.4)', macdL:'#1976d2', macdS:'#e67e22', macdU:'rgba(229,57,53,0.5)', macdD:'rgba(46,125,50,0.5)', rsi:'#6c3fd4', rsio:'rgba(229,57,53,0.15)', rsiu:'rgba(46,125,50,0.15)', k:'#e67e22', d:'#1976d2', j:'#8e44ad', x:'#bdbdbd' }
  };
  function clr(){return dark?C.dark:C.light;}

  function mkChart(el, timeVis) {
    const co = clr();
    return LightweightCharts.createChart(el, {
      layout:{background:{color:co.bg},textColor:co.txt},
      grid:{vertLines:{color:co.grid},horzLines:{color:co.grid}},
      crosshair:{mode:LightweightCharts.CrosshairMode.Normal,vertLine:{color:co.x,labelBackgroundColor:co.x},horzLine:{color:co.x,labelBackgroundColor:co.x}},
      rightPriceScale:{borderColor:co.bd},
      timeScale:{borderColor:co.bd,timeVisible:!!timeVis,secondsVisible:false},
    });
  }

  function init() {
    var el;

    el = document.getElementById('mainChart');
    if (el) {
      mainChart = mkChart(el, true);
      candleSeries = mainChart.addCandlestickSeries({upColor:clr().up,downColor:clr().dn,borderUpColor:clr().up,borderDownColor:clr().dn,wickUpColor:clr().up,wickDownColor:clr().dn});
      ma5 = mainChart.addLineSeries({color:clr().ma5,lineWidth:1,priceLineVisible:false,lastValueVisible:false});
      ma10= mainChart.addLineSeries({color:clr().ma10,lineWidth:1,priceLineVisible:false,lastValueVisible:false});
      ma20= mainChart.addLineSeries({color:clr().ma20,lineWidth:1,priceLineVisible:false,lastValueVisible:false});
      bollU=mainChart.addLineSeries({color:clr().boll,lineWidth:1,lineStyle:0,priceLineVisible:false,lastValueVisible:false});
      bollM=mainChart.addLineSeries({color:clr().boll,lineWidth:1,lineStyle:0,priceLineVisible:false,lastValueVisible:false});
      bollL=mainChart.addLineSeries({color:clr().boll,lineWidth:1,lineStyle:0,priceLineVisible:false,lastValueVisible:false});
    }

    el = document.getElementById('volumeChart');
    if (el) {
      volChart = mkChart(el, false);
      volSeries = volChart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'right'});
    }

    el = document.getElementById('macdChart');
    if (el) {
      macdChart = mkChart(el, false);
      macdHist=macdChart.addHistogramSeries({priceScaleId:'right'});
      macdSig =macdChart.addLineSeries({color:clr().macdS,lineWidth:1,priceLineVisible:false,lastValueVisible:false,priceScaleId:'right'});
      macdLine=macdChart.addLineSeries({color:clr().macdL,lineWidth:1,priceLineVisible:false,lastValueVisible:false,priceScaleId:'right'});
    }

    el = document.getElementById('rsiChart');
    if (el) {
      rsiChart = mkChart(el, false);
      rsiSeries=rsiChart.addLineSeries({color:clr().rsi,lineWidth:2,priceLineVisible:false,lastValueVisible:true,priceScaleId:'right'});
      rsiOver  =rsiChart.addLineSeries({color:clr().rsio,lineWidth:1,lineStyle:0,priceLineVisible:false,lastValueVisible:false,priceScaleId:'right'});
      rsiUnder =rsiChart.addLineSeries({color:clr().rsiu,lineWidth:1,lineStyle:0,priceLineVisible:false,lastValueVisible:false,priceScaleId:'right'});
      kdjK=rsiChart.addLineSeries({color:clr().k,lineWidth:1.5,priceLineVisible:false,lastValueVisible:false,priceScaleId:'right',visible:false});
      kdjD=rsiChart.addLineSeries({color:clr().d,lineWidth:1.5,priceLineVisible:false,lastValueVisible:false,priceScaleId:'right',visible:false});
      kdjJ=rsiChart.addLineSeries({color:clr().j,lineWidth:1,priceLineVisible:false,lastValueVisible:false,priceScaleId:'right',visible:false});
    }

    // 同步
    if (mainChart) {
      var ts = mainChart.timeScale();
      var sync = function() {
        var r = ts.getVisibleLogicalRange();
        if (!r) return;
        [volChart,macdChart,rsiChart].forEach(function(ch){if(ch)ch.timeScale().setVisibleLogicalRange(r);});
      };
      ts.subscribeVisibleLogicalRangeChange(sync);
      ts.subscribeSizeChange(sync);
    }
    setTimeout(resize, 50);
  }

  function sma(d,n){var r=[];for(var i=0;i<d.length;i++){if(i<n-1){r.push(null);continue;}var s=0;for(var j=i-n+1;j<=i;j++)s+=d[j];r.push(s/n);}return r;}
  function ema(d,n){var r=[d[0]],k=2/(n+1);for(var i=1;i<d.length;i++)r.push(d[i]*k+r[i-1]*(1-k));return r;}
  function maData(cl,period,ohlc){var v=sma(cl,period),r=[];for(var i=0;i<ohlc.length;i++){if(v[i]!==null)r.push({time:ohlc[i].time,value:+v[i].toFixed(2)});}return r;}

  function calcBOLL(cl,n,mul){var s=sma(cl,n),r=[];for(var i=0;i<cl.length;i++){if(s[i]===null){r.push({u:null,m:null,l:null});continue;}var sq=0,c=0;for(var j=i-n+1;j<=i;j++){sq+=Math.pow(cl[j]-s[i],2);c++;}var std=Math.sqrt(sq/c);r.push({u:s[i]+mul*std,m:s[i],l:s[i]-mul*std});}return r;}

  function calcRSI(cl,n){var r=[];for(var i=0;i<=n&&i<cl.length;i++)r.push(null);var ag=0,al=0;for(var i=1;i<=n&&i<cl.length;i++){var d=cl[i]-cl[i-1];if(d>0)ag+=d;else al-=d;}ag/=n;al/=n;if(cl.length>n+1)r[n+1]=+(100-100/(1+ag/(al||0.001))).toFixed(1);for(var i=n+2;i<cl.length;i++){var df=cl[i]-cl[i-1];ag=(ag*(n-1)+(df>0?df:0))/n;al=(al*(n-1)+(df<0?-df:0))/n;r.push(+(100-100/(1+ag/(al||0.001))).toFixed(1));}return r;}

  function calcKDJ(h,l,cl,n,m1,m2){var k=[],d=[],j=[],pK=50,pD=50;for(var i=0;i<cl.length;i++){if(i<n-1){k.push(null);d.push(null);j.push(null);continue;}var st=i-n+1;var hN=Math.max.apply(null,h.slice(st,i+1));var lN=Math.min.apply(null,l.slice(st,i+1));var rng=hN-lN;var rsv=rng===0?50:((cl[i]-lN)/rng)*100;if(i===n-1){pK=rsv;pD=rsv;}else{pK=(rsv+(m1-1)*pK)/m1;pD=(pK+(m2-1)*pD)/m2;}var cJ=3*pK-2*pD;k.push(+pK.toFixed(1));d.push(+pD.toFixed(1));j.push(+(cJ<0?0:cJ>100?100:cJ).toFixed(1));}return k.map(function(_,i){return k[i]!==null?{k:k[i],d:d[i],j:j[i]}:null;});}

  function calcMACD(cl){var e12=ema(cl,12),e26=ema(cl,26),ml=[];for(var i=0;i<cl.length;i++)ml.push(e12[i]-e26[i]);var sig=ema(ml,9),r=[];for(var i=0;i<cl.length;i++)r.push({macd:+ml[i].toFixed(4),signal:+sig[i].toFixed(4),histogram:+(ml[i]-sig[i]).toFixed(4)});return r;}

  function updateData(candles) {
    if (!candles||!candles.length||!candleSeries) return;
    var ohlc = candles.map(function(c){return{time:Math.floor(c.time/1000),open:c.open,high:c.high,low:c.low,close:c.close};});
    var cl = ohlc.map(function(o){return o.close;});
    var hi = ohlc.map(function(o){return o.high;});
    var lo = ohlc.map(function(o){return o.low;});

    candleSeries.setData(ohlc);
    ma5.setData(maData(cl,5,ohlc));
    ma10.setData(maData(cl,10,ohlc));
    ma20.setData(maData(cl,20,ohlc));

    var boll=calcBOLL(cl,20,2), bu=[],bm=[],bl=[];
    boll.forEach(function(b,i){if(b.u!==null){bu.push({time:ohlc[i].time,value:+b.u.toFixed(2)});bm.push({time:ohlc[i].time,value:+b.m.toFixed(2)});bl.push({time:ohlc[i].time,value:+b.l.toFixed(2)});}});
    bollU.setData(bu);bollM.setData(bm);bollL.setData(bl);

    volSeries.setData(candles.map(function(c){var t=Math.floor(c.time/1000);var prev=candles[candles.length-1];return{time:t,value:c.volume,color:c.close>=(prev?prev.close:c.open)?clr().upBg:clr().dnBg};}));

    var macdAll=calcMACD(cl);
    macdHist.setData(macdAll.map(function(d,i){return{time:ohlc[i].time,value:d.histogram,color:d.histogram>=0?clr().macdU:clr().macdD};}));
    macdSig.setData(macdAll.map(function(d,i){return{time:ohlc[i].time,value:d.signal};}));
    macdLine.setData(macdAll.map(function(d,i){return{time:ohlc[i].time,value:d.macd};}));

    var rv=calcRSI(cl,14), rd=[], od=[], ud=[];
    ohlc.forEach(function(o,i){if(rv[i]!==null){rd.push({time:o.time,value:rv[i]});od.push({time:o.time,value:70});ud.push({time:o.time,value:30});}});
    rsiSeries.setData(rd);rsiOver.setData(od);rsiUnder.setData(ud);

    var kdjAll=calcKDJ(hi,lo,cl,9,3,3), kk=[],kd_=[],kj=[];
    ohlc.forEach(function(o,i){if(kdjAll[i]){kk.push({time:o.time,value:kdjAll[i].k});kd_.push({time:o.time,value:kdjAll[i].d});kj.push({time:o.time,value:kdjAll[i].j});}});
    kdjK.setData(kk);kdjD.setData(kd_);kdjJ.setData(kj);
    applyIndicatorVis();

    mainChart.timeScale().fitContent();
  }

  function applyIndicatorVis() {
    var showRSI = indiMode==='rsi';
    if(rsiSeries)rsiSeries.applyOptions({visible:showRSI});
    if(rsiOver)rsiOver.applyOptions({visible:showRSI});
    if(rsiUnder)rsiUnder.applyOptions({visible:showRSI});
    if(kdjK)kdjK.applyOptions({visible:!showRSI});
    if(kdjD)kdjD.applyOptions({visible:!showRSI});
    if(kdjJ)kdjJ.applyOptions({visible:!showRSI});
  }

  function switchIndicator(m){indiMode=m;applyIndicatorVis();}
  function getIndicatorMode(){return indiMode;}

  function setTheme(dk){dark=dk;var co=clr();[{ch:mainChart,t:true},{ch:volChart,t:false},{ch:macdChart,t:false},{ch:rsiChart,t:false}].forEach(function(x){if(x.ch)x.ch.applyOptions({layout:{background:{color:co.bg},textColor:co.txt},grid:{vertLines:{color:co.grid},horzLines:{color:co.grid}},rightPriceScale:{borderColor:co.bd},timeScale:{borderColor:co.bd,timeVisible:x.t}});});}

  function resize(){['mainChart','volumeChart','macdChart','rsiChart'].forEach(function(id){var el=document.getElementById(id);var ch={mainChart:mainChart,volumeChart:volChart,macdChart:macdChart,rsiChart:rsiChart}[id];if(ch&&el)ch.applyOptions({width:el.clientWidth,height:el.clientHeight});});}

  // ── Overlay comparison ──
  function showOverlay(symbols) {
    overlaySymbols = symbols || [];
    var panel = document.getElementById('comparisonPanel');
    if (panel) panel.style.display = 'flex';
    overlayCanvas = document.getElementById('comparisonCanvas');
    resizeOverlay();
  }

  function hideOverlay() {
    overlaySymbols = [];
    overlayCanvas = null;
    var panel = document.getElementById('comparisonPanel');
    if (panel) panel.style.display = 'none';
  }

  function isOverlayActive() {
    return overlaySymbols.length > 0;
  }

  function resizeOverlay() {
    var canvas = document.getElementById('comparisonCanvas');
    var panel = document.getElementById('comparisonPanel');
    if (canvas && panel) {
      var w = panel.clientWidth;
      var h = panel.clientHeight;
      if (w > 0 && h > 0) {
        canvas.width = w;
        canvas.height = h;
      }
    }
  }

  /**
   * Draw overlay comparison chart on canvas
   * @param {Array} stockData - [{symbol, name, color, prices:[{time,value}]}]
   */
  function updateOverlay(stockData) {
    var canvas = overlayCanvas || document.getElementById('comparisonCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    if (w <= 0 || h <= 0) return;

    ctx.clearRect(0, 0, w, h);

    if (!stockData || stockData.length === 0) {
      ctx.fillStyle = dark ? '#666' : '#999';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('请在左侧勾选要对比的股票（最多5只）', w / 2, h / 2);
      return;
    }

    var pad = { top: 20, right: 20, bottom: 25, left: 45 };
    var pw = w - pad.left - pad.right;
    var ph = h - pad.top - pad.bottom;
    if (pw <= 0 || ph <= 0) return;

    // Find value range across all series
    var allVals = [];
    stockData.forEach(function(sd) {
      sd.prices.forEach(function(p) { allVals.push(p.value); });
    });
    if (allVals.length < 2) return;
    var minV = Math.min.apply(null, allVals);
    var maxV = Math.max.apply(null, allVals);
    var range = maxV - minV || 1;

    // Extend range slightly
    minV = minV - range * 0.05;
    maxV = maxV + range * 0.05;
    range = maxV - minV;

    // Y-axis labels
    ctx.fillStyle = dark ? '#999' : '#666';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    var ySteps = 4;
    for (var j = 0; j <= ySteps; j++) {
      var val = minV + (range * j / ySteps);
      var yy = pad.top + ph * (1 - j / ySteps);
      ctx.fillText(val.toFixed(1), pad.left - 4, yy + 3);
    }

    // Grid lines
    ctx.strokeStyle = dark ? '#2a2a2a' : '#e0e0e0';
    ctx.lineWidth = 0.5;
    for (j = 0; j <= ySteps; j++) {
      var gy = pad.top + ph * (1 - j / ySteps);
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(w - pad.right, gy);
      ctx.stroke();
    }

    // 100 base line (dashed)
    var baseY = pad.top + ph * (1 - (100 - minV) / range);
    if (baseY >= pad.top && baseY <= h - pad.bottom) {
      ctx.strokeStyle = dark ? '#555' : '#bbb';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pad.left, baseY);
      ctx.lineTo(w - pad.right, baseY);
      ctx.stroke();
      ctx.setLineDash([]);
      // "100" label
      ctx.fillStyle = dark ? '#999' : '#666';
      ctx.textAlign = 'left';
      ctx.fillText('100', w - pad.right + 2, baseY + 3);
      ctx.textAlign = 'right';
    }

    // Draw each stock line
    var lineColors = ['#ff5252', '#42a5f5', '#ff9800', '#ce93d8', '#66bb6a', '#f5a623'];
    var isLight = !dark;

    stockData.forEach(function(sd, si) {
      var color = sd.color || lineColors[si % lineColors.length];
      var pxData = sd.prices.map(function(p, pi) {
        return {
          x: pad.left + (pi / Math.max(sd.prices.length - 1, 1)) * pw,
          y: pad.top + ph * (1 - (p.value - minV) / range)
        };
      });

      // Draw line
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pxData.forEach(function(pt, pi) {
        if (pi === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();

      // Label at end
      var lastPt = pxData[pxData.length - 1];
      ctx.fillStyle = color;
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(sd.name, lastPt.x + 4, lastPt.y + 4);
      ctx.textAlign = 'right';
    });

    // X-axis label
    ctx.fillStyle = dark ? '#999' : '#666';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('规范化价格 (基准=100)', w / 2, h - 3);
  }

  // Add resizeOverlay to the main resize function
  var _origResize = resize;
  resize = function() {
    _origResize();
    resizeOverlay();
  };

  return {init:init,updateData:updateData,setTheme:setTheme,resize:resize,switchIndicator:switchIndicator,getIndicatorMode:getIndicatorMode,getMainChart:function(){return mainChart;},getCandleSeries:function(){return candleSeries;},showOverlay:showOverlay,hideOverlay:hideOverlay,isOverlayActive:isOverlayActive,updateOverlay:updateOverlay};
})();
