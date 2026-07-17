/* ============================================
   achievement-toast.js — Steam风格成就弹出 v2
   基于Steam/Xbox/PS平台研究 + Web Audio API
   ============================================ */

const AchievementToast = (() => {

  let queue = [];
  let showing = false;
  let container = null;
  let activeCount = 0;
  const MAX_VISIBLE = 3;

  // ── Tier Colors (Steam-inspired) ──
  const TIERS = {
    bronze:  { border:'#cd7f32', glow:'rgba(205,127,50,0.4)',  bg:'linear-gradient(135deg,rgba(45,35,25,0.97),rgba(25,18,12,0.97))', iconBg:'#5c3d1a', label:'COMMON' },
    silver:  { border:'#a8b8c8', glow:'rgba(168,184,200,0.4)', bg:'linear-gradient(135deg,rgba(35,38,42,0.97),rgba(18,20,24,0.97))', iconBg:'#3d434a', label:'RARE' },
    gold:    { border:'#ffd700', glow:'rgba(255,215,0,0.5)',    bg:'linear-gradient(135deg,rgba(40,35,20,0.97),rgba(20,18,10,0.97))', iconBg:'#5c5010', label:'EPIC' },
    diamond: { border:'#4dc9f6', glow:'rgba(77,201,246,0.6)',  bg:'linear-gradient(135deg,rgba(20,35,45,0.97),rgba(10,18,28,0.97))', iconBg:'#0d3b5c', label:'LEGENDARY' },
    secret:  { border:'#c084fc', glow:'rgba(192,132,252,0.6)',  bg:'linear-gradient(135deg,rgba(35,25,50,0.97),rgba(18,12,28,0.97))', iconBg:'#3d1a5c', label:'SECRET' },
  };

  // ── Web Audio API 音效 (Steam 三段式 + 稀有度变体) ──
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {} }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playSound(tier) {
    var ctx = getAudioCtx();
    if (!ctx) return;
    try {
      var now = ctx.currentTime;
      var masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);

      // Base notes: C5=523.25, E5=659.25, G5=783.99
      var notes = [523.25, 659.25, 783.99];
      var octave = tier === 'diamond' || tier === 'secret' ? 1 : 0;
      var extras = tier === 'diamond' ? [1046.50, 1318.51] : tier === 'gold' ? [1046.50] : [];
      var all = notes.map(function(n) { return n * Math.pow(2, octave); }).concat(extras);

      masterGain.gain.setValueAtTime(tier === 'diamond' ? 0.3 : 0.2, now);
      masterGain.gain.exponentialRampToValueAtTime(0.001, now + all.length * 0.13 + 0.5);

      all.forEach(function(freq, i) {
        var osc = ctx.createOscillator(), g = ctx.createGain();
        osc.connect(g); g.connect(masterGain);
        osc.type = i === 0 ? 'triangle' : 'sine';
        var t = now + i * 0.12;
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.linearRampToValueAtTime(freq * 1.02, t + 0.45);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.22, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.start(t); osc.stop(t + 0.55);
      });

      // Diamond: shimmer + bass
      if (tier === 'diamond') {
        var sh = ctx.createOscillator(), sg = ctx.createGain();
        sh.connect(sg); sg.connect(masterGain);
        sh.type = 'sine'; sh.frequency.setValueAtTime(8000, now + 0.25);
        sh.frequency.exponentialRampToValueAtTime(14000, now + 0.7);
        sg.gain.setValueAtTime(0.06, now + 0.25);
        sg.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
        sh.start(now + 0.25); sh.stop(now + 0.7);
      }
    } catch(e) { /* silent */ }
  }

  // ── 传奇成就粒子特效 ──
  function spawnParticles() {
    for (var i = 0; i < 40; i++) {
      var p = document.createElement('div');
      var colors = ['#ffd700','#4dc9f6','#c084fc','#ff5252','#66bb6a','#fff'];
      var c = colors[Math.floor(Math.random() * colors.length)];
      var x = 20 + Math.random() * 60; // % from left
      p.style.cssText = [
        'position:fixed;bottom:30px;left:' + x + '%;z-index:5001;',
        'width:' + (4 + Math.random() * 8) + 'px;height:' + (4 + Math.random() * 8) + 'px;',
        'background:' + c + ';border-radius:50%;pointer-events:none;',
        'animation:achParticle ' + (0.8 + Math.random() * 1.2) + 's ease-out forwards;',
        'animation-delay:' + (Math.random() * 0.15) + 's;'
      ].join('');
      document.body.appendChild(p);
      setTimeout(function() { if (p.parentNode) p.remove(); }, 1800);
    }
  }

  // ── Toast 容器 ──
  function ensureContainer() {
    if (container && document.body.contains(container)) return;
    container = document.createElement('div');
    container.id = 'achievementToastContainer';
    container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:5000;display:flex;flex-direction:column-reverse;gap:10px;pointer-events:none;';
    document.body.appendChild(container);
  }

  // ── 创建 Toast ──
  function createToast(ach) {
    var tc = TIERS[ach.tier] || TIERS.bronze;
    var el = document.createElement('div');
    el.className = 'ach-toast';
    el.setAttribute('data-tier', ach.tier);
    el.style.cssText = [
      'display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:8px;',
      'background:' + tc.bg + ';border:1px solid rgba(255,255,255,0.06);',
      'border-left:4px solid ' + tc.border + ';',
      'box-shadow:0 0 24px ' + tc.glow + ',0 4px 20px rgba(0,0,0,0.5);',
      'min-width:300px;max-width:380px;pointer-events:auto;cursor:pointer;',
      'font-family:-apple-system,"Microsoft YaHei",sans-serif;position:relative;overflow:hidden;',
      'opacity:0;transform:translateX(120%);',
    ].join('');

    // Shine sweep element (Steam style)
    var shine = document.createElement('div');
    shine.style.cssText = 'position:absolute;top:0;left:-100%;width:50%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.06),rgba(255,255,255,0.1),rgba(255,255,255,0.06),transparent);transform:skewX(-20deg);pointer-events:none;';
    el.appendChild(shine);

    // Auto-dismiss progress bar
    var progressBar = document.createElement('div');
    progressBar.style.cssText = 'position:absolute;bottom:0;left:0;height:3px;background:' + tc.border + ';border-radius:0 0 0 4px;width:100%;transition:none;';
    el.appendChild(progressBar);

    // Icon
    var iconEl = document.createElement('div');
    iconEl.style.cssText = 'width:50px;height:50px;border-radius:50%;background:' + tc.iconBg + ';display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;border:2px solid ' + tc.border + ';';
    iconEl.textContent = ach.tier === 'secret' && false ? '❓' : (ach.icon || '🏆');

    // Content
    var textEl = document.createElement('div');
    textEl.style.cssText = 'flex:1;min-width:0;';
    textEl.innerHTML =
      '<div style="font-size:9px;color:' + tc.border + ';text-transform:uppercase;letter-spacing:1.5px;font-weight:800;margin-bottom:3px">🏆 ' + tc.label + ' ACHIEVEMENT</div>' +
      '<div style="font-size:14px;font-weight:700;color:#e5e7eb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + ach.name + '</div>' +
      '<div style="font-size:11px;color:#9ca3af;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + ach.desc + '</div>';

    el.appendChild(iconEl);
    el.appendChild(textEl);

    // Click to dismiss
    el.addEventListener('click', function() { dismiss(el); });

    return { el: el, shine: shine, progressBar: progressBar, tier: ach.tier };
  }

  // ── 显示队列 ──
  function show(ach) {
    ensureContainer();
    queue.push(ach);
    if (!showing) processQueue();
  }

  function processQueue() {
    if (queue.length === 0 || activeCount >= MAX_VISIBLE) { showing = false; return; }
    showing = true;
    var ach = queue.shift();
    var parts = createToast(ach);
    activeCount++;
    container.appendChild(parts.el);

    // Legendary particles
    if (ach.tier === 'diamond') spawnParticles();

    // Sound
    playSound(ach.tier);

    // Animate in
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        parts.el.style.transition = 'all 0.4s cubic-bezier(0.34,1.56,0.64,1)';
        parts.el.style.opacity = '1';
        parts.el.style.transform = 'translateX(0)';
        // Shine sweep
        setTimeout(function() {
          parts.shine.style.transition = 'left 0.7s ease-out';
          parts.shine.style.left = '120%';
        }, 250);
        // Progress bar countdown
        var duration = (ach.tier === 'diamond' || ach.tier === 'secret') ? 6000 : 5000;
        parts.progressBar.style.transition = 'width ' + duration + 'ms linear';
        requestAnimationFrame(function() { parts.progressBar.style.width = '0%'; });
        setTimeout(function() { dismiss(parts.el); }, duration);
      });
    });

    // Process next after delay
    setTimeout(function() { if (activeCount < MAX_VISIBLE) processQueue(); }, 300);
  }

  function dismiss(el) {
    if (!el || el._dismissing) return;
    el._dismissing = true;
    el.style.transition = 'all 0.25s ease-in';
    el.style.opacity = '0';
    el.style.transform = 'translateX(120%)';
    setTimeout(function() {
      if (el.parentNode) el.parentNode.removeChild(el);
      activeCount--;
      processQueue();
    }, 300);
  }

  // ── 成就画廊 ──
  function renderGallery(containerEl) {
    if (!containerEl) return;
    var all = (typeof AchievementEngine !== 'undefined') ? AchievementEngine.getAll() : [];
    var unlocked = (typeof AchievementEngine !== 'undefined') ? AchievementEngine.getUnlocked() : [];
    var unlockedIds = {};
    unlocked.forEach(function(a) { unlockedIds[a.id] = true; });

    var tierOrder = { diamond:0, secret:1, gold:2, silver:3, bronze:4 };
    all.sort(function(a, b) {
      if (!!unlockedIds[a.id] !== !!unlockedIds[b.id]) return unlockedIds[a.id] ? -1 : 1;
      return (tierOrder[a.tier]||5) - (tierOrder[b.tier]||5);
    });

    var tc = TIERS;
    var html = '<div style="display:flex;flex-direction:column;gap:6px;padding:8px">';
    all.forEach(function(ach) {
      var isUnlocked = !!unlockedIds[ach.id];
      var t = tc[ach.tier] || tc.bronze;
      var isHidden = ach.tier === 'secret' && !isUnlocked;
      var icon = isHidden ? '❓' : (ach.icon || '🏆');
      var name = isHidden ? '???' : ach.name;
      var desc = isHidden ? '隐藏成就 — 继续探索！' : ach.desc;
      var opacity = isUnlocked ? '' : 'opacity:0.5;';
      var filter = isUnlocked ? '' : 'filter:grayscale(1);';
      var borderColor = isUnlocked ? t.border : 'var(--border)';

      var progress = '';
      if (!isUnlocked && ach.progress && typeof AchievementEngine !== 'undefined') {
        var p = AchievementEngine.getProgress(ach);
        if (p) {
          progress = '<div style="margin-top:4px;height:3px;background:rgba(255,255,255,0.08);border-radius:2px"><div style="height:100%;width:' + p.pct + '%;background:' + t.border + ';border-radius:2px;transition:width 0.5s"></div></div><div style="font-size:9px;color:var(--text-muted);margin-top:2px">' + p.current + '/' + p.target + '</div>';
        }
      }
      var rarity = ach.rarity ? '<div style="font-size:9px;color:var(--text-muted);margin-top:2px">🌐 ' + ach.rarity + '% 的玩家拥有</div>' : '';
      var time = isUnlocked && AchievementEngine.getUnlockTime(ach.id)
        ? '<div style="font-size:9px;color:' + t.border + ';margin-top:2px">解锁于 ' + new Date(AchievementEngine.getUnlockTime(ach.id)).toLocaleDateString('zh-CN') + '</div>' : '';

      html += '<div style="padding:8px;border-radius:6px;border:1px solid ' + borderColor + ';' + opacity + 'background:var(--bg-input);display:flex;align-items:flex-start;gap:8px">' +
        '<span style="font-size:24px;flex-shrink:0;' + filter + '">' + icon + '</span>' +
        '<div style="flex:1;min-width:0">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-primary);display:flex;align-items:center;gap:6px">' + name +
        (isUnlocked ? '<span style="font-size:8px;font-weight:800;text-transform:uppercase;padding:1px 5px;border-radius:3px;background:rgba(' + (ach.tier==='diamond'?'77,201,246':ach.tier==='gold'?'255,215,0':ach.tier==='silver'?'168,184,200':'205,127,50') + ',0.2);color:' + t.border + '">' + t.label + '</span>' : '') +
        '</div>' +
        '<div style="font-size:10px;color:var(--text-secondary)">' + desc + '</div>' +
        rarity + time + progress +
        '</div></div>';
    });
    html += '</div>';
    containerEl.innerHTML = html;
  }

  return {
    show, playSound, renderGallery,
    getQueueLength: function() { return queue.length; },
    isShowing: function() { return showing; },
  };
})();
